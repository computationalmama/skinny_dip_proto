#!/usr/bin/env python3
"""
Simple Local RAG with Web Chat Interface
100% offline web UI for your documents
"""

import chromadb
from langchain_community.document_loaders import PyPDFLoader, DirectoryLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.embeddings import OllamaEmbeddings
from langchain_community.llms import Ollama
import os
from flask import Flask, render_template_string, request, jsonify
from datetime import datetime

class SimpleRAG:
    def __init__(self):
        self.db_path = "../rag_database"
        self.docs_path = "../docs"

        # Local Ollama
        self.embeddings = OllamaEmbeddings(model="nomic-embed-text")
        self.llm = Ollama(model="qwen2.5:7b")

        # Local ChromaDB
        self.client = chromadb.PersistentClient(path=self.db_path)

    def build(self):
        """Build database from PDFs"""
        print("📂 Loading PDFs...")
        loader = DirectoryLoader(
            self.docs_path,
            glob="**/*.pdf",
            loader_cls=PyPDFLoader
        )
        docs = loader.load()

        if not docs:
            print(f"❌ No PDFs found in {self.docs_path}/")
            return False

        print(f"✂️  Splitting {len(docs)} documents...")
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=50
        )
        chunks = splitter.split_documents(docs)

        print(f"🧮 Creating embeddings for {len(chunks)} chunks...")
        collection = self.client.get_or_create_collection("docs")

        # Clear existing data
        try:
            collection.delete(ids=[f"chunk_{i}" for i in range(10000)])
        except:
            pass

        for i, chunk in enumerate(chunks):
            embedding = self.embeddings.embed_documents([chunk.page_content])[0]
            collection.add(
                ids=[f"chunk_{i}"],
                documents=[chunk.page_content],
                embeddings=[embedding],
                metadatas=[chunk.metadata or {}]
            )

            if (i + 1) % 10 == 0:
                print(f"  {i + 1}/{len(chunks)}")

        print(f"✅ Database built! {len(chunks)} chunks ready")
        return True

    def ask(self, question):
        """Ask a question and return answer with sources"""
        try:
            collection = self.client.get_collection("docs")
        except:
            return {
                "answer": "Database not found. Please build the database first.",
                "sources": [],
                "error": True
            }

        # Embed question
        q_embedding = self.embeddings.embed_documents([question])[0]

        # Retrieve relevant chunks
        results = collection.query(
            query_embeddings=[q_embedding],
            n_results=3
        )

        if not results['documents'][0]:
            return {
                "answer": "No relevant information found in the documents.",
                "sources": [],
                "error": False
            }

        # Build context
        context = "\n\n".join(results['documents'][0])

        # Generate answer
        prompt = f"""Use this context to answer. If unsure, say so.

Context:
{context}

Question: {question}

Answer:"""

        answer = self.llm.invoke(prompt)

        # Get unique sources
        sources = list(set([
            m.get('source', 'Unknown').split('/')[-1]
            for m in results['metadatas'][0]
        ]))

        return {
            "answer": answer,
            "sources": sources,
            "error": False
        }

    def get_stats(self):
        """Get database statistics"""
        try:
            collection = self.client.get_collection("docs")
            count = collection.count()
            return {"count": count, "exists": True}
        except:
            return {"count": 0, "exists": False}

# ============ WEB APP ============
app = Flask(__name__)
rag = SimpleRAG()

# HTML Template
HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Local RAG Chat</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Courier New', Courier, monospace;
            background: #1a1a1a;
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }

        .container {
            background: #ffffff;
            border: 4px solid #000000;
            box-shadow: 10px 10px 0px #000000;
            width: 100%;
            max-width: 900px;
            height: 90vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .header {
            background: #F5F5A0;
            color: #000000;
            padding: 20px 30px;
            border-bottom: 4px solid #000000;
        }

        .header h1 {
            font-size: 22px;
            font-weight: 900;
            letter-spacing: 3px;
            text-transform: uppercase;
            margin-bottom: 6px;
        }

        .header .stats {
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 30px;
            background: #efefef;
        }

        .message {
            margin-bottom: 20px;
            display: flex;
            gap: 15px;
            animation: slideIn 0.1s ease;
        }

        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(8px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .message.user {
            justify-content: flex-end;
        }

        .message-content {
            max-width: 70%;
            padding: 12px 16px;
            border: 2px solid #000000;
            line-height: 1.6;
        }

        .message.user .message-content {
            background: #000000;
            color: #F5F5A0;
            box-shadow: 4px 4px 0px #F5F5A0;
        }

        .message.assistant .message-content {
            background: #ffffff;
            color: #000000;
            box-shadow: 4px 4px 0px #000000;
        }

        .message.assistant .sources {
            margin-top: 10px;
            padding-top: 10px;
            border-top: 2px solid #000000;
            font-size: 11px;
            color: #000000;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .message.assistant .sources strong {
            color: #000000;
            font-weight: 900;
        }

        .input-container {
            padding: 20px 30px;
            background: #ffffff;
            border-top: 4px solid #000000;
            display: flex;
            gap: 12px;
        }

        #questionInput {
            flex: 1;
            padding: 12px 14px;
            border: 3px solid #000000;
            font-size: 14px;
            font-family: 'Courier New', Courier, monospace;
            outline: none;
            background: #ffffff;
            transition: none;
        }

        #questionInput:focus {
            background: #F5F5A0;
        }

        #askButton {
            padding: 12px 28px;
            background: #F5F5A0;
            color: #000000;
            border: 3px solid #000000;
            font-size: 13px;
            font-weight: 900;
            font-family: 'Courier New', Courier, monospace;
            text-transform: uppercase;
            letter-spacing: 2px;
            cursor: pointer;
            transition: none;
            box-shadow: 4px 4px 0px #000000;
        }

        #askButton:hover:not(:disabled) {
            background: #000000;
            color: #F5F5A0;
            box-shadow: none;
            transform: translate(4px, 4px);
        }

        #askButton:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }

        .loading {
            display: none;
            padding: 12px 16px;
            background: #ffffff;
            border: 3px solid #000000;
            max-width: 70%;
            box-shadow: 4px 4px 0px #000000;
        }

        .loading.active {
            display: block;
        }

        .loading-dots {
            display: flex;
            gap: 6px;
        }

        .loading-dots span {
            width: 8px;
            height: 8px;
            background: #000000;
            animation: bounce 1.4s infinite;
        }

        .loading-dots span:nth-child(2) {
            animation-delay: 0.2s;
        }

        .loading-dots span:nth-child(3) {
            animation-delay: 0.4s;
        }

        @keyframes bounce {
            0%, 80%, 100% {
                transform: scale(0);
            }
            40% {
                transform: scale(1);
            }
        }

        .empty-state {
            text-align: center;
            color: #000000;
            padding: 60px 20px;
            border: 3px dashed #000000;
            margin: 20px;
            background: #ffffff;
        }

        .empty-state h2 {
            font-size: 18px;
            margin-bottom: 12px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 3px;
        }

        .empty-state p {
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .error-message {
            background: #ffffff;
            border: 3px solid #000000;
            color: #000000;
            padding: 12px 16px;
            max-width: 70%;
            box-shadow: 4px 4px 0px #cc0000;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 Local RAG Chat</h1>
            <div class="stats" id="stats">Loading...</div>
        </div>

        <div class="chat-container" id="chatContainer">
            <div class="empty-state">
                <h2>👋 Welcome!</h2>
                <p>Ask questions about your documents</p>
            </div>
        </div>

        <div class="input-container">
            <input
                type="text"
                id="questionInput"
                placeholder="Ask a question about your documents..."
                autocomplete="off"
            >
            <button id="askButton">Ask</button>
        </div>
    </div>

    <script>
        const chatContainer = document.getElementById('chatContainer');
        const questionInput = document.getElementById('questionInput');
        const askButton = document.getElementById('askButton');
        const statsEl = document.getElementById('stats');

        // Load stats
        async function loadStats() {
            try {
                const response = await fetch('/stats');
                const data = await response.json();
                if (data.exists) {
                    statsEl.textContent = `📚 ${data.count} chunks ready`;
                } else {
                    statsEl.textContent = '⚠️ No database found - run build first';
                }
            } catch (error) {
                statsEl.textContent = '❌ Error loading stats';
            }
        }

        // Add message to chat
        function addMessage(text, isUser, sources = []) {
            // Remove empty state
            const emptyState = chatContainer.querySelector('.empty-state');
            if (emptyState) {
                emptyState.remove();
            }

            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${isUser ? 'user' : 'assistant'}`;

            let sourcesHTML = '';
            if (sources.length > 0) {
                sourcesHTML = `<div class="sources"><strong>📄 Sources:</strong> ${sources.join(', ')}</div>`;
            }

            messageDiv.innerHTML = `
                <div class="message-content">
                    ${text}
                    ${sourcesHTML}
                </div>
            `;

            chatContainer.appendChild(messageDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        // Show/hide loading
        function showLoading(show) {
            let loading = chatContainer.querySelector('.loading');
            if (show) {
                if (!loading) {
                    loading = document.createElement('div');
                    loading.className = 'loading';
                    loading.innerHTML = `
                        <div class="loading-dots">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                    `;
                    chatContainer.appendChild(loading);
                }
                loading.classList.add('active');
                chatContainer.scrollTop = chatContainer.scrollHeight;
            } else {
                if (loading) {
                    loading.remove();
                }
            }
        }

        // Ask question
        async function askQuestion() {
            const question = questionInput.value.trim();
            if (!question) return;

            // Add user message
            addMessage(question, true);
            questionInput.value = '';

            // Disable input
            questionInput.disabled = true;
            askButton.disabled = true;

            // Show loading
            showLoading(true);

            try {
                const response = await fetch('/ask', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ question })
                });

                const data = await response.json();

                // Hide loading
                showLoading(false);

                if (data.error) {
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'message assistant';
                    errorDiv.innerHTML = `<div class="error-message">${data.answer}</div>`;
                    chatContainer.appendChild(errorDiv);
                } else {
                    addMessage(data.answer, false, data.sources);
                }
            } catch (error) {
                showLoading(false);
                const errorDiv = document.createElement('div');
                errorDiv.className = 'message assistant';
                errorDiv.innerHTML = `<div class="error-message">Error: ${error.message}</div>`;
                chatContainer.appendChild(errorDiv);
            } finally {
                // Re-enable input
                questionInput.disabled = false;
                askButton.disabled = false;
                questionInput.focus();
            }
        }

        // Event listeners
        askButton.addEventListener('click', askQuestion);
        questionInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                askQuestion();
            }
        });

        // Initial load
        loadStats();
        questionInput.focus();
    </script>
</body>
</html>
"""

@app.route('/')
def index():
    """Serve the chat interface"""
    return render_template_string(HTML_TEMPLATE)

@app.route('/ask', methods=['POST'])
def ask():
    """Handle question from UI"""
    data = request.json
    question = data.get('question', '')

    if not question:
        return jsonify({
            "answer": "Please ask a question.",
            "sources": [],
            "error": True
        })

    result = rag.ask(question)
    return jsonify(result)

@app.route('/stats')
def stats():
    """Get database stats"""
    return jsonify(rag.get_stats())

# ============ MAIN ============
if __name__ == "__main__":
    import sys

    # CLI commands
    if len(sys.argv) > 1:
        command = sys.argv[1]

        if command == "build":
            rag.build()

        elif command == "serve" or command == "web":
            print("\n🌐 Starting web interface...")
            stats = rag.get_stats()
            if stats['exists']:
                print(f"📊 Database ready: {stats['count']} chunks")
            else:
                print("⚠️  No database found. Build it first with: python rag_web.py build")

            print("\n✨ Open in your browser:")
            print("   http://localhost:6600")
            print("\n🛑 Press Ctrl+C to stop\n")

            app.run(host='0.0.0.0', port=6600, debug=False)

        else:
            print("Commands:")
            print("  build - Build database from PDFs")
            print("  serve - Start web interface")

    else:
        print("\n🤖 Local RAG Web Interface")
        print("=" * 50)
        print("\nCommands:")
        print("  python rag_web.py build  - Build database")
        print("  python rag_web.py serve  - Start web interface")
