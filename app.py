import os
import re
import json
import pickle
from datetime import datetime, timezone
import numpy as np
from flask import Flask, request, jsonify, render_template, Response
from openai import OpenAI
from rank_bm25 import BM25Okapi

# Load env variables manually from .env
env_path = ".env"
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ[k.strip()] = v.strip()

# Initialize Opik (observability)
# The library automatically picks up OPIK_API_KEY from environment variables.
# All traces go to a dedicated project (override via OPIK_PROJECT_NAME in .env).
os.environ.setdefault("OPIK_PROJECT_NAME", "acl2026-paper-explorer")
import opik
from opik import track
from opik.integrations.openai import track_openai

app = Flask(__name__)

# Config
openai_key = os.environ.get("OPENAI_API_KEY")
openai_model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
openai_embedding_model = os.environ.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
cache_path = "acl_papers_embeddings.pkl"

if not openai_key:
    print("WARNING: OPENAI_API_KEY not found in environment.")

# Wrap the OpenAI client so every embeddings/chat call is logged to Opik
# with token usage and latency.
openai_client = track_openai(OpenAI(api_key=openai_key))

# Global variables for loaded data
papers = []
embeddings = None
bm25 = None
paper_num_to_idx = {}

def tokenize(text):
    """Punctuation-free lowercase tokenizer for BM25."""
    text = str(text).lower()
    text = re.sub(r'[^\w\s]', ' ', text)
    return text.split()

def load_data():
    global papers, embeddings, bm25, paper_num_to_idx
    if not os.path.exists(cache_path):
        raise FileNotFoundError(f"Cache file {cache_path} not found. Please run preprocess_papers.py first.")
    
    print(f"Loading cached papers and embeddings from {cache_path}...")
    with open(cache_path, 'rb') as f:
        cache_data = pickle.load(f)
        
    papers = cache_data['papers']
    embeddings = cache_data['embeddings']
    
    print(f"Loaded {len(papers)} papers.")
    
    # L2 normalize dense embeddings for cosine similarity
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    embeddings = embeddings / norms
    
    paper_num_to_idx = {p['paper_number']: i for i, p in enumerate(papers)}
    
    # Build BM25 index
    print("Building BM25 index...")
    corpus = []
    for paper in papers:
        # Build document token representation using Title & Abstract
        doc_text = f"{paper['title']} {paper['abstract']}"
        corpus.append(tokenize(doc_text))
        
    bm25 = BM25Okapi(corpus)
    print("BM25 index built successfully.")

# Load the indices on start
load_data()

@track(name="get_openai_embedding", type="tool")
def get_embedding(text):
    res = openai_client.embeddings.create(
        input=[text],
        model=openai_embedding_model
    )
    return np.array(res.data[0].embedding, dtype=np.float32)

@track(name="hybrid_search", type="general")
def hybrid_search_internal(query, top_n=10):
    """
    Performs hybrid search:
    1. Keyword search (BM25 Okapi)
    2. Dense semantic search (OpenAI Embedding + Cosine Similarity)
    3. Fuses rankings using Reciprocal Rank Fusion (RRF) with k=60
    """
    if not query:
        return []
        
    # 1. BM25 scoring
    tokenized_query = tokenize(query)
    bm25_scores = bm25.get_scores(tokenized_query)
    # Ranks (indices sorted by score descending)
    bm25_ranks = np.argsort(bm25_scores)[::-1]
    
    # 2. Dense semantic scoring
    query_emb = get_embedding(query)
    # Compute cosine similarities (dot product since matrix and vector are normalized)
    dense_scores = np.dot(embeddings, query_emb)
    # Ranks (indices sorted by score descending)
    dense_ranks = np.argsort(dense_scores)[::-1]
    
    # 3. Reciprocal Rank Fusion (RRF)
    # Maps paper_index -> 1-based rank position
    bm25_rank_map = {doc_idx: rank + 1 for rank, doc_idx in enumerate(bm25_ranks)}
    dense_rank_map = {doc_idx: rank + 1 for rank, doc_idx in enumerate(dense_ranks)}
    
    rrf_scores = np.zeros(len(papers))
    k = 60
    
    for doc_idx in range(len(papers)):
        rank_bm25 = bm25_rank_map[doc_idx]
        rank_dense = dense_rank_map[doc_idx]
        rrf_scores[doc_idx] = 1.0 / (k + rank_bm25) + 1.0 / (k + rank_dense)
        
    # Sort paper indices by fused RRF scores descending
    top_indices = np.argsort(rrf_scores)[::-1][:top_n]
    
    results = []
    for rank, doc_idx in enumerate(top_indices):
        paper = papers[doc_idx].copy()
        paper['rrf_score'] = float(rrf_scores[doc_idx])
        paper['bm25_rank'] = int(bm25_rank_map[doc_idx])
        paper['dense_rank'] = int(dense_rank_map[doc_idx])
        results.append(paper)
        
    return results

@track(name="openai_chat_completion", type="llm")
def generate_llm_response(query, context_papers):
    context_items = []
    for idx, paper in enumerate(context_papers):
        context_items.append(
            f"[{idx+1}] Paper ID: {paper['paper_number']}\n"
            f"Title: {paper['title']}\n"
            f"Authors: {paper['authors']}\n"
            f"Session: {paper['session']} ({paper['date']} {paper['time_pdt']})\n"
            f"Room: {paper['room']}\n"
            f"Abstract: {paper['abstract']}\n"
            f"-------------------"
        )
    context_str = "\n".join(context_items)
    
    system_prompt = (
        "You are an expert AI conference assistant helping researchers explore papers at the ACL 2026 conference.\n"
        "Answer the user's question using the provided context containing relevant papers. "
        "Support your answers with references to the paper numbers (e.g. [1], [2]) and cite paper titles/numbers.\n"
        "Format your answer using Markdown with headings, bullet points, and bold text for readability. "
        "If the papers are not relevant, answer the question best you can but note that the papers in context do not directly discuss it.\n\n"
        f"Context:\n{context_str}"
    )
    
    response = openai_client.chat.completions.create(
        model=openai_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query}
        ],
        temperature=0.3
    )
    return response.choices[0].message.content

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/about')
def about():
    return render_template('about.html')

@app.route('/api/search', methods=['POST'])
def search_api():
    data = request.json or {}
    query = data.get('query', '').strip()
    top_n = int(data.get('top_n', 10))
    
    # Cap top_n between 5 and 50
    top_n = max(5, min(50, top_n))
    
    if not query:
        return jsonify({"results": []})
        
    try:
        results = hybrid_search_internal(query, top_n=top_n)
        return jsonify({"results": results})
    except Exception as e:
        print(f"Search API error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/chat', methods=['POST'])
def chat_api():
    data = request.json or {}
    query = data.get('query', '').strip()
    top_n = int(data.get('top_n', 10))
    
    # Cap top_n between 5 and 50
    top_n = max(5, min(50, top_n))
    
    if not query:
        return jsonify({"error": "Query cannot be empty"}), 400
        
    try:
        # Retrieve context papers using RRF Hybrid search
        context_papers = hybrid_search_internal(query, top_n=top_n)
        
        # Generate response using LLM
        answer = generate_llm_response(query, context_papers)
        
        return jsonify({
            "answer": answer,
            "results": context_papers
        })
    except Exception as e:
        print(f"Chat API error: {e}")
        return jsonify({"error": str(e)}), 500

@track(name="find_similar_papers", type="general")
def find_similar_internal(paper_number, top_n=10):
    """Returns the papers closest to the given one by dense embedding cosine similarity."""
    idx = paper_num_to_idx.get(paper_number)
    if idx is None:
        return None
        
    # Embeddings are L2-normalized, so dot product == cosine similarity
    sims = np.dot(embeddings, embeddings[idx])
    order = np.argsort(sims)[::-1]
    
    results = []
    for doc_idx in order:
        if doc_idx == idx:
            continue
        paper = papers[doc_idx].copy()
        paper['similarity'] = float(sims[doc_idx])
        results.append(paper)
        if len(results) >= top_n:
            break
    return results

@app.route('/api/similar/<paper_number>', methods=['GET'])
def similar_api(paper_number):
    try:
        top_n = int(request.args.get('top_n', 10))
    except ValueError:
        top_n = 10
    top_n = max(5, min(50, top_n))
    
    try:
        results = find_similar_internal(paper_number, top_n=top_n)
        if results is None:
            return jsonify({"error": "Paper not found"}), 404
        return jsonify({"results": results})
    except Exception as e:
        print(f"Similar API error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/papers', methods=['GET'])
def get_all_papers():
    """Returns basic details of all papers for the schedule view."""
    # We strip abstract for speed/payload size in schedule views
    schedule_papers = []
    for paper in papers:
        schedule_papers.append({
            'paper_number': paper['paper_number'],
            'title': paper['title'],
            'authors': paper['authors'],
            'mode': paper['mode'],
            'room': paper['room'],
            'session': paper['session'],
            'whova_session': paper['whova_session'],
            'date': paper['date'],
            'time_pdt': paper['time_pdt'],
            'start_time_utc': paper['start_time_utc'],
            'end_time_utc': paper['end_time_utc']
        })
    return jsonify(schedule_papers)

@app.route('/api/paper/<paper_number>', methods=['GET'])
def get_paper_details(paper_number):
    """Returns the full metadata (including abstract) for a single paper."""
    for paper in papers:
        if paper['paper_number'] == paper_number:
            return jsonify(paper)
    return jsonify({"error": "Paper not found"}), 404

@app.route('/api/feedback', methods=['POST'])
def feedback_api():
    """Stores user feedback/feature requests as JSON lines in feedback.jsonl."""
    data = request.json or {}
    message = (data.get('message') or '').strip()
    if not message:
        return jsonify({"error": "Message cannot be empty"}), 400
        
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "type": str(data.get('type') or 'general')[:50],
        "message": message[:5000],
        "email": str(data.get('email') or '').strip()[:200],
        "user_agent": request.headers.get('User-Agent', '')[:300]
    }
    
    try:
        with open('feedback.jsonl', 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return jsonify({"success": True})
    except Exception as e:
        print(f"Feedback API error: {e}")
        return jsonify({"error": "Could not save feedback"}), 500

@app.route('/api/export_ics', methods=['GET'])
def export_ics():
    """Generates an ICS calendar file for a comma-separated list of paper numbers."""
    paper_nums_str = request.args.get('papers', '')
    if not paper_nums_str:
        return "No papers selected", 400
        
    paper_nums = [p.strip() for p in paper_nums_str.split(',') if p.strip()]
    
    # Find matching papers
    selected_papers = [p for p in papers if p['paper_number'] in paper_nums]
    if not selected_papers:
        return "No matching papers found", 404
        
    # Build ICS text
    ics_lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//ACL 2026 Paper Explorer//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH"
    ]
    
    for paper in selected_papers:
        if not paper['start_time_utc'] or not paper['end_time_utc']:
            # Skip if no session scheduled
            continue
            
        summary = f"ACL 2026: {paper['title']}"
        # Escape characters for ICS
        description = f"Authors: {paper['authors']}\\nSession: {paper['session']}\\nRoom: {paper['room']}\\nAbstract: {paper['abstract'][:300]}..."
        description = description.replace('\r', '').replace('\n', '\\n').replace(',', '\\,')
        location = paper['room'] or "N/A"
        
        ics_lines.extend([
            "BEGIN:VEVENT",
            f"UID:{paper['paper_number']}@acl2026.org",
            f"DTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
            f"DTSTART:{paper['start_time_utc']}",
            f"DTEND:{paper['end_time_utc']}",
            f"SUMMARY:{summary}",
            f"DESCRIPTION:{description}",
            f"LOCATION:{location}",
            "END:VEVENT"
        ])
        
    ics_lines.append("END:VCALENDAR")
    ics_content = "\r\n".join(ics_lines)
    
    return Response(
        ics_content,
        mimetype="text/calendar",
        headers={"Content-disposition": "attachment; filename=acl_schedule.ics"}
    )

if __name__ == '__main__':
    # Bind to all interfaces for local testing or droplets
    app.run(host='0.0.0.0', port=5000, debug=True)
