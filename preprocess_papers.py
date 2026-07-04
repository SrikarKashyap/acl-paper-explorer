import os
import re
import pickle
import time
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from openai import OpenAI

# Load env variables manually from .env
env_path = ".env"
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ[k.strip()] = v.strip()

api_key = os.environ.get("OPENAI_API_KEY")
model = os.environ.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")

if not api_key:
    raise ValueError("OPENAI_API_KEY not found in environment or .env file.")

csv_path = "acl-papers.csv"
output_path = "acl_papers_embeddings.pkl"

print(f"Reading papers from {csv_path}...")
df = pd.read_csv(csv_path)

# Clean column headers
df.columns = [col.strip().replace('\n', ' ') for col in df.columns]
print("Cleaned Columns:", list(df.columns))

def parse_session_times(date_str, time_str):
    if pd.isna(date_str) or pd.isna(time_str):
        return None, None
    
    date_str = str(date_str).strip()
    time_str = str(time_str).strip()
    
    # Map date
    if 'July 5' in date_str:
        day = '2026-07-05'
    elif 'July 6' in date_str:
        day = '2026-07-06'
    elif 'July 7' in date_str:
        day = '2026-07-07'
    else:
        return None, None
        
    # Split times
    parts = re.split(r'\s*-\s*', time_str)
    if len(parts) != 2:
        return None, None
        
    start_t, end_t = parts[0].strip(), parts[1].strip()
    
    def to_24h(t_str):
        if ':' in t_str:
            try:
                h, m = t_str.split(':')
                h = int(h)
                m = int(m)
                return f"{h:02d}:{m:02d}:00"
            except:
                return None
        return None

    start_24 = to_24h(start_t)
    end_24 = to_24h(end_t)
    
    if not start_24 or not end_24:
        return None, None
        
    start_dt_str = f"{day}T{start_24}"
    end_dt_str = f"{day}T{end_24}"
    
    try:
        start_dt = datetime.strptime(start_dt_str, "%Y-%m-%dT%H:%M:%S")
        end_dt = datetime.strptime(end_dt_str, "%Y-%m-%dT%H:%M:%S")
        
        # PDT is UTC-7. To get UTC, we add 7 hours.
        start_utc = start_dt + timedelta(hours=7)
        end_utc = end_dt + timedelta(hours=7)
        
        return start_utc.strftime("%Y%m%dT%H%M%SZ"), end_utc.strftime("%Y%m%dT%H%M%SZ")
    except Exception as e:
        print(f"Error parsing date {start_dt_str} / {end_dt_str}: {e}")
        return None, None

print("Processing paper metadata...")
papers = []
texts_to_embed = []

for idx, row in df.iterrows():
    title = str(row.get('Title', '')).strip()
    abstract = str(row.get('Abstract', '')).strip()
    if pd.isna(row.get('Abstract')) or abstract.lower() == 'nan':
        abstract = ""
        
    paper_number = str(row.get('Paper number', f'MOCK-{idx}')).strip()
    authors = str(row.get('Authors Names', '')).strip()
    mode = str(row.get('Presentation mode', 'Not specified')).strip()
    presenter = str(row.get('Presenters Name', '')).strip()
    room = str(row.get('Room Location', '')).strip()
    session = str(row.get('Session', '')).strip()
    whova_session = str(row.get('Underline/Whova Session Name', '')).strip()
    session_date = str(row.get('Session Date', '')).strip()
    session_time = str(row.get('Session time PDT', '')).strip()
    
    # Clean authors trailing semicolons
    if authors.endswith(';'):
        authors = authors[:-1].strip()
        
    start_utc, end_utc = parse_session_times(session_date, session_time)
    
    paper_meta = {
        'paper_number': paper_number,
        'title': title,
        'abstract': abstract,
        'authors': authors,
        'mode': mode,
        'presenter': presenter,
        'room': room if pd.notna(row.get('Room Location')) else '',
        'session': session if pd.notna(row.get('Session')) else '',
        'whova_session': whova_session if pd.notna(row.get('Underline/Whova Session Name')) else '',
        'date': session_date if pd.notna(row.get('Session Date')) else '',
        'time_pdt': session_time if pd.notna(row.get('Session time PDT')) else '',
        'start_time_utc': start_utc,
        'end_time_utc': end_utc
    }
    
    papers.append(paper_meta)
    
    # Text block for embedding
    embedding_text = f"Title: {title}\nAbstract: {abstract}"
    texts_to_embed.append(embedding_text)

print(f"Total papers to embed: {len(texts_to_embed)}")

# Initialize OpenAI Client
client = OpenAI(api_key=api_key)

embeddings = []
batch_size = 200
num_batches = (len(texts_to_embed) - 1) // batch_size + 1

print("Generating embeddings using OpenAI API...")
for i in range(0, len(texts_to_embed), batch_size):
    batch_texts = texts_to_embed[i:i+batch_size]
    print(f"Processing batch {i//batch_size + 1} of {num_batches}...")
    
    retries = 3
    while retries > 0:
        try:
            res = client.embeddings.create(input=batch_texts, model=model)
            batch_embs = [record.embedding for record in res.data]
            embeddings.extend(batch_embs)
            break
        except Exception as e:
            print(f"OpenAI Embedding API error: {e}. Retrying in 5 seconds...")
            retries -= 1
            time.sleep(5)
            if retries == 0:
                raise e

embeddings = np.array(embeddings, dtype=np.float32)
print("Embeddings generated successfully. Matrix shape:", embeddings.shape)

# Save cache file
cache_data = {
    'papers': papers,
    'embeddings': embeddings
}

print(f"Saving data cache to {output_path}...")
with open(output_path, 'wb') as f:
    pickle.dump(cache_data, f)

print("Preprocessing complete!")
