// --- Global State ---
let starredPapers = JSON.parse(localStorage.getItem('acl2026_starred') || '[]');
let allPapers = []; // Client-side cache for schedule and starred view
let activeTab = 'search-chat';
let retrievedPapersMap = {}; // Maps paper_number -> paper details for search/chat results

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initTabs();
    initSettings();
    initSearch();
    initStarred();
    initFeedback();
    initInstallPrompt();
    loadScheduleData(); // Load all papers for schedule in background
    updateStarredCount();
});

// --- Theme (Dark / Light) ---
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.querySelector('#theme-toggle i');
    if (icon) {
        icon.className = theme === 'light' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    }
}

function initTheme() {
    applyTheme(localStorage.getItem('acl2026_theme') || 'light');
    document.getElementById('theme-toggle').addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        localStorage.setItem('acl2026_theme', next);
        applyTheme(next);
    });
}

// --- Tab Navigation ---
function initTabs() {
    const navButtons = document.querySelectorAll('.nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            activeTab = targetTab;
            
            // Sync active state across both top nav and mobile bottom nav
            navButtons.forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === targetTab));
            tabContents.forEach(tc => tc.classList.remove('active'));

            document.getElementById(`tab-${targetTab}`).classList.add('active');

            if (targetTab === 'starred') {
                renderStarredView();
            } else if (targetTab === 'schedule') {
                renderScheduleView();
            }
        });
    });
}

// --- Settings Panel ---
function initSettings() {
    const toggleBtn = document.getElementById('settings-toggle');
    const dropdown = document.getElementById('settings-dropdown');
    const slider = document.getElementById('top-n-slider');
    const sliderVal = document.getElementById('top-n-val');

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== toggleBtn) {
            dropdown.classList.remove('active');
        }
    });

    slider.addEventListener('input', () => {
        sliderVal.textContent = slider.value;
    });
}

// --- Add to Home Screen (PWA install) ---
let deferredInstallPrompt = null;

function initInstallPrompt() {
    // Register the service worker that makes the app installable
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    
    const banner = document.getElementById('install-banner');
    const installBtn = document.getElementById('install-btn');
    const hintEl = document.getElementById('install-hint');
    
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    const dismissed = localStorage.getItem('acl2026_install_dismissed') === '1';
    const isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    
    if (isStandalone || dismissed || !isMobile) return;
    
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    
    if (isIOS) {
        // iOS has no install prompt API — show instructions instead
        hintEl.innerHTML = 'Tap <i class="fa-solid fa-arrow-up-from-bracket"></i> then "Add to Home Screen"';
        installBtn.style.display = 'none';
        banner.classList.add('visible');
    } else {
        // Android/Chrome: wait for the browser to say the app is installable
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredInstallPrompt = e;
            banner.classList.add('visible');
        });
        
        installBtn.addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;
            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            banner.classList.remove('visible');
        });
    }
    
    document.getElementById('install-dismiss').addEventListener('click', () => {
        banner.classList.remove('visible');
        localStorage.setItem('acl2026_install_dismissed', '1');
    });
}

// --- Feedback Modal ---
function initFeedback() {
    const modal = document.getElementById('feedback-modal');
    
    document.getElementById('feedback-toggle').addEventListener('click', () => {
        modal.classList.add('active');
    });
    
    document.getElementById('close-feedback').addEventListener('click', () => {
        modal.classList.remove('active');
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
    });
    
    document.getElementById('feedback-submit').addEventListener('click', submitFeedback);
    
    // Allow linking straight to the feedback form (e.g. /#feedback from the About page)
    if (location.hash === '#feedback') {
        modal.classList.add('active');
    }
}

async function submitFeedback() {
    const messageEl = document.getElementById('feedback-message');
    const emailEl = document.getElementById('feedback-email');
    const typeEl = document.getElementById('feedback-type');
    const statusEl = document.getElementById('feedback-status');
    const submitBtn = document.getElementById('feedback-submit');
    
    const message = messageEl.value.trim();
    if (!message) {
        statusEl.textContent = 'Please write a message first.';
        statusEl.className = 'feedback-status error';
        return;
    }
    
    submitBtn.disabled = true;
    statusEl.textContent = 'Sending...';
    statusEl.className = 'feedback-status';
    
    try {
        const res = await fetch('/api/feedback', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                type: typeEl.value,
                message: message,
                email: emailEl.value.trim()
            })
        });
        const data = await res.json();
        
        if (data.success) {
            statusEl.textContent = 'Thank you! Your feedback has been recorded.';
            statusEl.className = 'feedback-status success';
            messageEl.value = '';
            emailEl.value = '';
        } else {
            statusEl.textContent = data.error || 'Something went wrong. Please try again.';
            statusEl.className = 'feedback-status error';
        }
    } catch (e) {
        console.error(e);
        statusEl.textContent = 'Could not reach the server. Please try again.';
        statusEl.className = 'feedback-status error';
    } finally {
        submitBtn.disabled = false;
    }
}

// --- Starred Manager (localStorage) ---
function getStarred() {
    return starredPapers;
}

function isStarred(paperNum) {
    return starredPapers.includes(paperNum);
}

function toggleStar(paperNum, event) {
    if (event) event.stopPropagation(); // Stop modal opening

    const index = starredPapers.indexOf(paperNum);
    if (index === -1) {
        starredPapers.push(paperNum);
    } else {
        starredPapers.splice(index, 1);
    }

    localStorage.setItem('acl2026_starred', JSON.stringify(starredPapers));
    updateStarredCount();
    
    // Sync all star icons on screen
    document.querySelectorAll(`.star-btn[data-paper="${paperNum}"]`).forEach(btn => {
        btn.classList.toggle('starred', isStarred(paperNum));
        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = isStarred(paperNum) ? 'fa-solid fa-star' : 'fa-regular fa-star';
        }
    });

    // If on starred view, re-render immediately
    if (activeTab === 'starred') {
        renderStarredView();
    }
}

function updateStarredCount() {
    document.querySelectorAll('.starred-count-badge').forEach(el => {
        el.textContent = starredPapers.length;
    });
    const exportBtn = document.getElementById('btn-export-starred');
    if (exportBtn) {
        exportBtn.style.display = starredPapers.length > 0 ? 'flex' : 'none';
    }
}

// --- My Schedule (Starred) View Render ---
// Groups starred papers by day, then by session (in chronological order),
// so the tab reads like a personal conference itinerary.
function renderStarredView() {
    const listContainer = document.getElementById('starred-list');
    listContainer.innerHTML = '';

    const starredList = allPapers.filter(p => isStarred(p.paper_number));

    if (starredList.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-starred">
                <i class="fa-regular fa-star"></i>
                <p>No starred papers yet. Star papers from the search results or schedule to build your itinerary.</p>
            </div>
        `;
        return;
    }

    // Group by day
    const dayOrder = ['Sun. July 5', 'Mon. July 6', 'Tues. July 7'];
    const byDay = {};
    starredList.forEach(p => {
        const day = p.date || 'Unscheduled';
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(p);
    });

    const sortedDays = Object.keys(byDay).sort((a, b) => {
        const ia = dayOrder.indexOf(a);
        const ib = dayOrder.indexOf(b);
        // Unknown/unscheduled days go last
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    sortedDays.forEach(day => {
        const dayPapers = byDay[day];

        const dayHeading = document.createElement('div');
        dayHeading.className = 'day-heading';
        dayHeading.innerHTML = `
            <i class="fa-regular fa-calendar"></i>
            <h3>${day}</h3>
            <span class="badge">${dayPapers.length} paper${dayPapers.length > 1 ? 's' : ''}</span>
        `;
        listContainer.appendChild(dayHeading);

        // Group this day's papers by session
        const sessionsMap = {};
        dayPapers.forEach(paper => {
            const sName = paper.session || 'Unscheduled / Poster Session';
            if (!sessionsMap[sName]) {
                sessionsMap[sName] = {
                    name: sName,
                    time: paper.time_pdt || 'N/A',
                    startUtc: paper.start_time_utc || 'Z',
                    papers: []
                };
            }
            sessionsMap[sName].papers.push(paper);
        });

        const sortedSessions = Object.values(sessionsMap).sort((a, b) =>
            String(a.startUtc).localeCompare(String(b.startUtc))
        );

        sortedSessions.forEach(session => {
            const paperNums = session.papers.map(p => p.paper_number).join(',');

            const accordion = document.createElement('div');
            accordion.className = 'session-accordion expanded';
            accordion.innerHTML = `
                <div class="accordion-header">
                    <div class="accordion-title-block">
                        <h3>${session.name}</h3>
                        <div class="accordion-sub-meta">
                            <span><i class="fa-regular fa-clock"></i> ${session.time} PDT</span>
                        </div>
                    </div>
                    <div class="accordion-actions">
                        <button class="btn-ics-export" title="Add session to calendar" onclick="exportSessionICS('${paperNums}', event)">
                            <i class="fa-solid fa-file-arrow-down"></i> <span class="btn-label">Add to Calendar</span>
                        </button>
                        <i class="fa-solid fa-chevron-down accordion-icon"></i>
                    </div>
                </div>
                <div class="accordion-body">
                    <div class="accordion-papers-list"></div>
                </div>
            `;

            const paperListContainer = accordion.querySelector('.accordion-papers-list');
            session.papers.forEach(paper => {
                const row = document.createElement('div');
                row.className = 'accordion-paper-row';
                row.addEventListener('click', () => openPaperModal(paper.paper_number));

                row.innerHTML = `
                    <div class="accordion-paper-details">
                        <h4>${paper.title}</h4>
                        <span>${paper.authors}</span>
                        <div class="card-meta">
                            <span class="mode-badge ${getModeClass(paper.mode)}">${paper.mode}</span>
                            ${paper.room ? `<span><i class="fa-solid fa-door-open"></i> ${paper.room}</span>` : ''}
                            <span>ID: ${paper.paper_number}</span>
                        </div>
                    </div>
                    <button class="star-btn starred" data-paper="${paper.paper_number}" onclick="toggleStar('${paper.paper_number}', event)">
                        <i class="fa-solid fa-star"></i>
                    </button>
                `;
                paperListContainer.appendChild(row);
            });

            const header = accordion.querySelector('.accordion-header');
            header.addEventListener('click', () => {
                accordion.classList.toggle('expanded');
            });

            listContainer.appendChild(accordion);
        });
    });
}

function initStarred() {
    const exportStarredBtn = document.getElementById('btn-export-starred');
    exportStarredBtn.addEventListener('click', () => {
        if (starredPapers.length === 0) return;
        window.location.href = `/api/export_ics?papers=${starredPapers.join(',')}`;
    });
}

// --- Schedule Data Loading & View ---
async function loadScheduleData() {
    try {
        const res = await fetch('/api/papers');
        allPapers = await res.json();
        
        // Hide loading state
        const loading = document.getElementById('schedule-loading');
        if (loading) loading.style.display = 'none';
        
        const wrapper = document.getElementById('sessions-wrapper');
        if (wrapper) wrapper.style.display = 'flex';
        
        if (activeTab === 'schedule') {
            renderScheduleView();
        }
    } catch (e) {
        console.error("Error loading schedule database:", e);
        const loading = document.getElementById('schedule-loading');
        if (loading) {
            loading.innerHTML = `<span style="color:var(--color-rose)"><i class="fa-solid fa-circle-exclamation"></i> Error loading schedule database. Please refresh.</span>`;
        }
    }
}

function renderScheduleView() {
    if (allPapers.length === 0) return;

    const wrapper = document.getElementById('sessions-wrapper');
    wrapper.innerHTML = '';

    const activeDayBtn = document.querySelector('.day-btn.active');
    const selectedDate = activeDayBtn ? activeDayBtn.getAttribute('data-date') : 'Sun. July 5';
    const modeFilter = document.getElementById('mode-filter').value;
    const searchQuery = document.getElementById('schedule-search').value.toLowerCase().trim();

    // Filter papers for this day
    let filtered = allPapers.filter(p => p.date === selectedDate);

    // Apply Presentation Mode filter
    if (modeFilter !== 'all') {
        filtered = filtered.filter(p => p.mode.toLowerCase().includes(modeFilter.toLowerCase()));
    }

    // Apply client-side text search (title, authors, room, session name)
    if (searchQuery) {
        filtered = filtered.filter(p => 
            p.title.toLowerCase().includes(searchQuery) ||
            p.authors.toLowerCase().includes(searchQuery) ||
            p.room.toLowerCase().includes(searchQuery) ||
            p.session.toLowerCase().includes(searchQuery) ||
            p.paper_number.toLowerCase().includes(searchQuery)
        );
    }

    if (filtered.length === 0) {
        wrapper.innerHTML = `
            <div class="empty-results">
                <i class="fa-solid fa-calendar-minus"></i>
                <p>No papers match the selected criteria for this day.</p>
            </div>
        `;
        return;
    }

    // Group papers by Session Name
    const sessionsMap = {};
    filtered.forEach(paper => {
        const sName = paper.session || 'Unscheduled / Poster Session';
        if (!sessionsMap[sName]) {
            sessionsMap[sName] = {
                name: sName,
                time: paper.time_pdt || 'N/A',
                room: paper.room || 'N/A',
                whova: paper.whova_session || '',
                papers: []
            };
        }
        sessionsMap[sName].papers.push(paper);
    });

    // Render each session accordion, sorted chronologically by start time
    const sortedSessions = Object.values(sessionsMap).sort((a, b) => {
        const timeA = a.papers[0].start_time_utc || 'Z';
        const timeB = b.papers[0].start_time_utc || 'Z';
        return String(timeA).localeCompare(String(timeB));
    });

    sortedSessions.forEach(session => {
        const accordion = document.createElement('div');
        accordion.className = 'session-accordion';
        
        // Count how many starred papers inside this session
        const starredInSessionCount = session.papers.filter(p => isStarred(p.paper_number)).length;
        const starBadge = starredInSessionCount > 0 
            ? `<span class="badge" style="background:#fbbf24;color:#000;margin-left:6px;"><i class="fa-solid fa-star"></i> ${starredInSessionCount} starred</span>`
            : '';

        const paperNums = session.papers.map(p => p.paper_number).join(',');

        accordion.innerHTML = `
            <div class="accordion-header">
                <div class="accordion-title-block">
                    <h3>${session.name} ${starBadge}</h3>
                    <div class="accordion-sub-meta">
                        <span><i class="fa-regular fa-clock"></i> ${session.time} PDT</span>
                        <span><i class="fa-solid fa-door-open"></i> ${session.room}</span>
                        ${session.whova ? `<span><i class="fa-solid fa-tag"></i> ${session.whova}</span>` : ''}
                    </div>
                </div>
                <div class="accordion-actions">
                    <button class="btn-ics-export" title="Export session to calendar" onclick="exportSessionICS('${paperNums}', event)">
                        <i class="fa-solid fa-file-arrow-down"></i> <span class="btn-label">Export Session</span>
                    </button>
                    <i class="fa-solid fa-chevron-down accordion-icon"></i>
                </div>
            </div>
            <div class="accordion-body">
                <div class="accordion-papers-list">
                    <!-- Papers rows appended here -->
                </div>
            </div>
        `;

        const paperListContainer = accordion.querySelector('.accordion-papers-list');
        session.papers.forEach(paper => {
            const row = document.createElement('div');
            row.className = 'accordion-paper-row';
            row.addEventListener('click', () => openPaperModal(paper.paper_number));

            const isPaperStarred = isStarred(paper.paper_number);
            const starClass = isPaperStarred ? 'starred' : '';
            const starIcon = isPaperStarred ? 'fa-solid fa-star' : 'fa-regular fa-star';

            row.innerHTML = `
                <div class="accordion-paper-details">
                    <h4>${paper.title}</h4>
                    <span>${paper.authors}</span>
                    <div class="card-meta">
                        <span class="mode-badge ${getModeClass(paper.mode)}">${paper.mode}</span>
                        ${paper.room ? `<span><i class="fa-solid fa-door-open"></i> ${paper.room}</span>` : ''}
                        <span>ID: ${paper.paper_number}</span>
                    </div>
                </div>
                <button class="star-btn ${starClass}" data-paper="${paper.paper_number}" onclick="toggleStar('${paper.paper_number}', event)">
                    <i class="${starIcon}"></i>
                </button>
            `;
            paperListContainer.appendChild(row);
        });

        // Toggle Accordion Click
        const header = accordion.querySelector('.accordion-header');
        header.addEventListener('click', () => {
            accordion.classList.toggle('expanded');
        });

        wrapper.appendChild(accordion);
    });
}

// Helper to export session papers as ICS
window.exportSessionICS = function(paperNums, event) {
    event.stopPropagation(); // Stop accordion toggle
    if (!paperNums) return;
    window.location.href = `/api/export_ics?papers=${paperNums}`;
};

// --- Schedule Listeners ---
document.querySelectorAll('.day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderScheduleView();
    });
});

document.getElementById('mode-filter').addEventListener('change', renderScheduleView);
document.getElementById('schedule-search').addEventListener('input', renderScheduleView);

// --- Search & Chat Functionality ---
function initSearch() {
    const queryInput = document.getElementById('query-input');
    const btnSearch = document.getElementById('btn-search');
    const btnChat = document.getElementById('btn-chat');
    
    // Suggested topics click handler
    document.querySelectorAll('.suggest-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            queryInput.value = btn.textContent;
            // Run RAG chat by default for suggestions
            runChatQuery(btn.textContent);
        });
    });

    queryInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            runChatQuery(queryInput.value.trim());
        }
    });

    btnSearch.addEventListener('click', () => {
        runSearchQuery(queryInput.value.trim());
    });

    btnChat.addEventListener('click', () => {
        runChatQuery(queryInput.value.trim());
    });
}

// Open paper modal when a [n] citation link is clicked
document.getElementById('chat-messages').addEventListener('click', (e) => {
    const link = e.target.closest('.cite-link');
    if (link) {
        e.preventDefault();
        openPaperModal(link.dataset.paper);
    }
});

// Helper to show messages panel and hide welcome box
function showMessagesContainer() {
    document.getElementById('welcome-box').style.display = 'none';
    document.getElementById('chat-messages').style.display = 'flex';
}

// 1. Search Only
async function runSearchQuery(query) {
    if (!query) return;
    
    showMessagesContainer();
    appendUserMessage(query);
    
    const sidebar = document.getElementById('results-sidebar');
    const list = document.getElementById('results-list');
    const count = document.getElementById('results-count');
    
    list.innerHTML = `<div class="empty-results"><i class="fa-solid fa-spinner fa-spin"></i><p>Retrieving documents...</p></div>`;
    count.textContent = 'Searching...';
    
    appendAssistantMessage(`_Performing hybrid search for papers matching **"${query}"**..._`);
    
    const topN = document.getElementById('top-n-slider').value;
    
    try {
        const res = await fetch('/api/search', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({query: query, top_n: parseInt(topN)})
        });
        const data = await res.json();
        
        if (data.results) {
            renderResultsSidebar(data.results);
            appendAssistantMessage(`Found the top **${data.results.length}** most relevant papers. Check them out in the **Results Panel** on the right side!`);
        } else {
            list.innerHTML = `<div class="empty-results"><p>No results found.</p></div>`;
            count.textContent = '0 papers';
        }
    } catch (e) {
        console.error(e);
        appendAssistantMessage(`Error completing search request.`);
        list.innerHTML = `<div class="empty-results"><p>Error fetching search results.</p></div>`;
    }
}

// 2. Ask Assistant (RAG)
async function runChatQuery(query) {
    if (!query) return;
    
    showMessagesContainer();
    appendUserMessage(query);
    
    const sidebar = document.getElementById('results-sidebar');
    const list = document.getElementById('results-list');
    const count = document.getElementById('results-count');
    
    list.innerHTML = `<div class="empty-results"><i class="fa-solid fa-spinner fa-spin"></i><p>Retrieving context papers...</p></div>`;
    count.textContent = 'Retrieving...';
    
    // Append loading assistant bubble
    const loadingBubbleId = appendLoadingMessage();
    
    const topN = document.getElementById('top-n-slider').value;
    
    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({query: query, top_n: parseInt(topN)})
        });
        const data = await res.json();
        
        // Remove loading bubble
        removeLoadingMessage(loadingBubbleId);
        
        if (data.error) {
            appendAssistantMessage(`Error: ${data.error}`);
            return;
        }
        
        // Render sidebar first so cited papers are cached for the modal,
        // then append the answer with clickable [n] citations
        if (data.results) {
            renderResultsSidebar(data.results);
        }
        appendAssistantMessage(data.answer, data.results);
    } catch (e) {
        console.error(e);
        removeLoadingMessage(loadingBubbleId);
        appendAssistantMessage(`Sorry, I encountered an error communicating with the chat endpoint.`);
    }
}

// 3. Find Similar Papers (from paper modal)
async function findSimilarPapers(paper) {
    // Close the modal and jump to the Search & Chat tab where results render
    document.getElementById('paper-modal').classList.remove('active');
    document.getElementById('modal-cal-dropdown').classList.remove('active');
    document.querySelector('.nav-btn[data-tab="search-chat"]').click();

    showMessagesContainer();
    appendUserMessage(`Find papers similar to "${paper.title}"`);

    const list = document.getElementById('results-list');
    const count = document.getElementById('results-count');
    list.innerHTML = `<div class="empty-results"><i class="fa-solid fa-spinner fa-spin"></i><p>Finding similar papers...</p></div>`;
    count.textContent = 'Searching...';

    const topN = document.getElementById('top-n-slider').value;

    try {
        const res = await fetch(`/api/similar/${encodeURIComponent(paper.paper_number)}?top_n=${parseInt(topN)}`);
        const data = await res.json();

        if (data.results) {
            renderResultsSidebar(data.results);
            appendAssistantMessage(
                `Here are the **${data.results.length}** papers most similar to **"${paper.title}"**, ranked by abstract embedding similarity. Check the **Results Panel**!`
            );
        } else {
            appendAssistantMessage(`Error finding similar papers: ${data.error || 'unknown error'}`);
            list.innerHTML = `<div class="empty-results"><p>No similar papers found.</p></div>`;
            count.textContent = '0 papers';
        }
    } catch (e) {
        console.error(e);
        appendAssistantMessage(`Error completing the similar-papers request.`);
        list.innerHTML = `<div class="empty-results"><p>Error fetching similar papers.</p></div>`;
    }
}

// --- Chat Render Helpers ---
function appendUserMessage(text) {
    const chatLog = document.getElementById('chat-messages');
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper user';
    wrapper.innerHTML = `
        <div class="message-label">You</div>
        <div class="message-bubble">${escapeHtml(text)}</div>
    `;
    chatLog.appendChild(wrapper);
    chatLog.scrollTop = chatLog.scrollHeight;
}

// Turns [1], [2] references in the answer into clickable links that
// open the corresponding paper from the retrieved results.
function linkifyCitations(html, results) {
    if (!results || results.length === 0) return html;
    return html.replace(/\[(\d+)\]/g, (match, numStr) => {
        const idx = parseInt(numStr) - 1;
        if (idx >= 0 && idx < results.length) {
            const p = results[idx];
            return `<a class="cite-link" data-paper="${p.paper_number}" title="${escapeHtml(p.title)}">[${numStr}]</a>`;
        }
        return match;
    });
}

function appendAssistantMessage(markdownText, citedResults = null) {
    const chatLog = document.getElementById('chat-messages');
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper assistant';
    
    // Parse Markdown using marked.js
    let htmlContent = marked.parse(markdownText);
    if (citedResults) {
        htmlContent = linkifyCitations(htmlContent, citedResults);
    }
    
    wrapper.innerHTML = `
        <div class="message-label">Assistant</div>
        <div class="message-bubble">${htmlContent}</div>
    `;
    chatLog.appendChild(wrapper);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function appendLoadingMessage() {
    const chatLog = document.getElementById('chat-messages');
    const bubbleId = 'loading-' + Date.now();
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper assistant';
    wrapper.id = bubbleId;
    wrapper.innerHTML = `
        <div class="message-label">Assistant is thinking</div>
        <div class="message-bubble">
            <div class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    chatLog.appendChild(wrapper);
    chatLog.scrollTop = chatLog.scrollHeight;
    return bubbleId;
}

function removeLoadingMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// --- Results Sidebar Rendering ---
function renderResultsSidebar(papersList) {
    const list = document.getElementById('results-list');
    const count = document.getElementById('results-count');
    
    list.innerHTML = '';
    count.textContent = `${papersList.length} papers found`;
    
    if (papersList.length === 0) {
        list.innerHTML = `<div class="empty-results"><p>No papers match this query.</p></div>`;
        return;
    }
    
    papersList.forEach((paper, index) => {
        // Cache full details (including abstract) in local memory map
        retrievedPapersMap[paper.paper_number] = paper;
        
        const card = createPaperCard(paper, true, index + 1);
        list.appendChild(card);
    });
}

// --- Create Paper Card Element ---
function createPaperCard(paper, showScore = false, rankIndex = null) {
    const card = document.createElement('div');
    card.className = 'paper-card';
    card.addEventListener('click', () => openPaperModal(paper.paper_number));
    
    const isPaperStarred = isStarred(paper.paper_number);
    const starClass = isPaperStarred ? 'starred' : '';
    const starIcon = isPaperStarred ? 'fa-solid fa-star' : 'fa-regular fa-star';
    
    const rankBadge = rankIndex ? `<span class="badge" style="margin-right: 6px; background:#4f46e5;">#${rankIndex}</span>` : '';
    let scoreBadge = '';
    if (showScore && paper.rrf_score) {
        scoreBadge = `<span class="rrf-score-tag">RRF: ${paper.rrf_score.toFixed(4)}</span>`;
    } else if (showScore && paper.similarity !== undefined) {
        scoreBadge = `<span class="rrf-score-tag">Similarity: ${(paper.similarity * 100).toFixed(1)}%</span>`;
    }

    card.innerHTML = `
        <div class="card-top">
            <div style="display:flex; align-items:center;">
                ${rankBadge}
                <span class="card-num">${paper.paper_number}</span>
            </div>
            <button class="star-btn ${starClass}" data-paper="${paper.paper_number}" onclick="toggleStar('${paper.paper_number}', event)">
                <i class="${starIcon}"></i>
            </button>
        </div>
        <h4 class="paper-title">${paper.title}</h4>
        <div class="paper-authors">${paper.authors}</div>
        <div class="card-meta">
            <span class="mode-badge ${getModeClass(paper.mode)}">${paper.mode}</span>
            ${paper.room ? `<span><i class="fa-solid fa-door-open"></i> ${paper.room}</span>` : ''}
            ${paper.date ? `<span><i class="fa-regular fa-calendar"></i> ${paper.date}</span>` : ''}
        </div>
        ${scoreBadge}
    `;
    
    return card;
}

function getModeClass(mode) {
    if (!mode) return 'none';
    const m = mode.toLowerCase();
    if (m.includes('in-person')) return 'in-person';
    if (m.includes('virtual')) return 'virtual';
    return 'none';
}

// --- Modal Dialog Actions ---
async function openPaperModal(paperNumber) {
    const modal = document.getElementById('paper-modal');
    
    // Check if we already have the paper metadata including the abstract loaded
    let paper = retrievedPapersMap[paperNumber];
    
    // If not found in search results cache, look in schedule cache
    if (!paper) {
        paper = allPapers.find(p => p.paper_number === paperNumber);
    }
    
    if (!paper) return;

    // Set Loading state in modal
    document.getElementById('modal-paper-id').textContent = paper.paper_number;
    document.getElementById('modal-title').textContent = paper.title;
    document.getElementById('modal-authors').textContent = paper.authors;
    document.getElementById('modal-mode').textContent = paper.mode;
    document.getElementById('modal-mode').className = `mode-badge ${getModeClass(paper.mode)}`;
    document.getElementById('modal-room').textContent = paper.room || 'No Room Assigned';
    document.getElementById('modal-session').textContent = paper.session 
        ? `${paper.session} (${paper.date} ${paper.time_pdt})` 
        : 'Unscheduled / Poster Session';
    document.getElementById('modal-abstract').innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading abstract details...`;

    // Toggle star button state in modal
    const modalStarBtn = document.getElementById('modal-star-btn');
    modalStarBtn.className = isStarred(paper.paper_number) ? 'modal-action-btn starred' : 'modal-action-btn';
    modalStarBtn.innerHTML = isStarred(paper.paper_number) 
        ? `<i class="fa-solid fa-star" style="color:#fbbf24"></i> Starred`
        : `<i class="fa-regular fa-star"></i> Star Paper`;
    
    // Reset onClick handler for star button in modal
    modalStarBtn.onclick = () => {
        toggleStar(paper.paper_number);
        modalStarBtn.className = isStarred(paper.paper_number) ? 'modal-action-btn starred' : 'modal-action-btn';
        modalStarBtn.innerHTML = isStarred(paper.paper_number)
            ? `<i class="fa-solid fa-star" style="color:#fbbf24"></i> Starred`
            : `<i class="fa-regular fa-star"></i> Star Paper`;
    };

    // Set outer Links
    document.getElementById('modal-anthology-link').href = `https://aclanthology.org/search/?q=${encodeURIComponent(paper.title)}`;
    document.getElementById('modal-scholar-link').href = `https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`;

    // Find Similar Papers action
    document.getElementById('modal-similar-btn').onclick = () => findSimilarPapers(paper);

    // Show modal
    modal.classList.add('active');

    // Load abstract if it is not present (for schedule browsing)
    if (paper.abstract === undefined || paper.abstract === null || paper.abstract === '') {
        try {
            // Retrieve abstract from server using a single paper details request
            // Note: Since we are going to add this route to app.py next, it will fetch abstract correctly.
            const res = await fetch(`/api/paper/${paper.paper_number}`);
            const fullDetails = await res.json();
            paper.abstract = fullDetails.abstract;
        } catch (e) {
            console.error("Error loading abstract:", e);
            paper.abstract = "Abstract details failed to load from server. Please view in the ACL Anthology.";
        }
    }
    
    document.getElementById('modal-abstract').textContent = paper.abstract || "No abstract available.";

    // Calendar Link Generation (Google Calendar Template)
    if (paper.start_time_utc && paper.end_time_utc) {
        // Show calendar container buttons
        document.getElementById('modal-cal-btn').style.display = 'flex';
        
        const detailsText = `Paper Number: ${paper.paper_number}\nAuthors: ${paper.authors}\nSession: ${paper.session}\nRoom: ${paper.room}\n\nAbstract: ${paper.abstract ? paper.abstract.substring(0, 500) : ''}...`;
        const gCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('ACL 2026: ' + paper.title)}&dates=${paper.start_time_utc}/${paper.end_time_utc}&details=${encodeURIComponent(detailsText)}&location=${encodeURIComponent(paper.room || 'N/A')}&sf=true&output=xml`;
        
        document.getElementById('modal-gcal-link').href = gCalUrl;
        document.getElementById('modal-ics-link').href = `/api/export_ics?papers=${paper.paper_number}`;
    } else {
        // Hide calendar dropdown button if paper is unscheduled
        document.getElementById('modal-cal-btn').style.display = 'none';
    }
}

// Close Modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('paper-modal').classList.remove('active');
        document.getElementById('modal-cal-dropdown').classList.remove('active');
        document.getElementById('feedback-modal').classList.remove('active');
    }
});

document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('paper-modal').classList.remove('active');
    document.getElementById('modal-cal-dropdown').classList.remove('active');
});

document.getElementById('paper-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('paper-modal')) {
        document.getElementById('paper-modal').classList.remove('active');
        document.getElementById('modal-cal-dropdown').classList.remove('active');
    }
});

// Calendar Dropdown Toggle
const modalCalBtn = document.getElementById('modal-cal-btn');
const modalCalDropdown = document.getElementById('modal-cal-dropdown');
modalCalBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    modalCalDropdown.classList.toggle('active');
});

document.addEventListener('click', () => {
    if (modalCalDropdown) modalCalDropdown.classList.remove('active');
});
