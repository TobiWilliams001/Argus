"""Answer synthesis with a local Ollama model."""

import os
import re

import requests

OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("ARGUS_MODEL", "tinyllama")


def clean(text: str) -> str:
    text = re.sub(r'#+\s*', '', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    return text.strip()


def build_prompt(query: str, chunks: list[dict]) -> str:
    sources = "\n\n".join(f"Source [{i + 1}] ({c['source']}): {clean(c['text'])}"
                          for i, c in enumerate(chunks))
    return (
        "You are a research assistant. Answer the question using ONLY the provided sources.\n"
        "Use numbered citations like [1] or [2] in your answer to show which source you are using.\n"
        "Keep it to 2-3 detailed sentences.\n\n"
        f"{sources}\n\n"
        f"Question: {query}\n"
        "Answer:"
    )


def ollama(prompt: str, model: str = OLLAMA_MODEL, num_predict: int = 300,
           stop: list[str] | None = None, fmt: str | None = None, timeout: int = 120) -> str:
    body = {"model": model, "prompt": prompt, "stream": False,
            "options": {"temperature": 0.0, "num_predict": num_predict, "stop": stop or []}}
    if fmt:
        body["format"] = fmt
    r = requests.post(f"{OLLAMA_URL}/api/generate", json=body, timeout=timeout)
    r.raise_for_status()
    return r.json().get("response", "").strip()


def generate(query: str, chunks: list[dict], model: str = OLLAMA_MODEL) -> str | None:
    """LLM answer over the top 3 chunks, or None if the model gave no cited answer."""
    answer = ollama(build_prompt(query, chunks[:3]), model=model,
                    stop=["\n\n", "Question:", "Source ["])
    return answer if len(answer) >= 20 and "[" in answer else None


def synthesise(query: str, chunks: list[dict]) -> str:
    """Generated answer, falling back to the best passage when the LLM is unavailable or uncited."""
    top = chunks[0]
    try:
        answer = generate(query, chunks)
    except Exception as e:
        return f"Synthesis error: {e}. Best match: {clean(top['text'])[:300]}"
    return answer or f"According to {top['source']}, {clean(top['text'])[:300]}..."
