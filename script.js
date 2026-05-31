const API_URL = 'http://localhost:3001/api';
const ontomathParser = new OntoMathParser();
let parserInitialized = false;
const uploadButton = document.getElementById('uploadPdfButton');
const loadingIndicator = document.getElementById('pdfLoadingIndicator');
const pdfTextBlock = document.getElementById('pdfTextBlock');
const extractedTextWithHighlight = document.getElementById('extractedTextWithHighlight');
const pdfExtractedList = document.getElementById('pdfExtractedList');
const pdfAnalysisResults = document.getElementById('pdfAnalysisResults');

async function loadOntology() {
    try {
        const response = await fetch(`${API_URL}/ontology/terms`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const termsData = await response.json();
        ontomathParser.loadFromJSON(termsData);
        parserInitialized = true;
        console.log(` Онтология загружена: ${ontomathParser.getStats().totalTerms} терминов`);
        const editorText = document.getElementById('manualTextInput');
        if (editorText && editorText.value.trim()) analyzeEditorText();
    } catch (error) {
        console.error(error);
        parserInitialized = false;
        alert('Не удалось загрузить онтологию из GraphDB');
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : (m === '<' ? '&lt;' : '&gt;'));
}

function isWordChar(ch) {
    if (!ch.length) return false;
    return /[a-zA-Zа-яА-ЯёЁ0-9_\-']/.test(ch);
}

function highlightTermsInText(text, termsMap) {
    if (!termsMap.size) return escapeHtml(text);
    const sortedTerms = Array.from(termsMap.keys())
        .filter(term => term.length >= 3)
        .sort((a, b) => b.length - a.length);
    if (sortedTerms.length === 0) return escapeHtml(text);
    const regex = new RegExp(`(${sortedTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    let result = '';
    let lastIdx = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        result += escapeHtml(text.substring(lastIdx, start));
        const matchedWord = match[0];
        const lowerWord = matchedWord.toLowerCase();
        const beforeChar = start > 0 ? text[start - 1] : '';
        const afterChar = end < text.length ? text[end] : '';
        const isBeforeBoundary = !isWordChar(beforeChar);
        const isAfterBoundary = !isWordChar(afterChar);
        if (isBeforeBoundary && isAfterBoundary && termsMap.has(lowerWord)) {
            const term = termsMap.get(lowerWord);
            result += `<span class="highlight-term" data-term="${escapeHtml(matchedWord.toLowerCase())}" title="${escapeHtml(term.definition)}">${escapeHtml(matchedWord)}</span>`;
        } else {
            result += escapeHtml(matchedWord);
        }
        lastIdx = end;
    }
    result += escapeHtml(text.substring(lastIdx));
    return result;
}

async function renderFormulasInText(htmlWithSpans) {
    const spanPlaceholders = [];
    let processed = htmlWithSpans.replace(/<span class="highlight-term"[^>]*>.*?<\/span>/gi, (match) => {
        spanPlaceholders.push(match);
        return `__SPAN_PH_${spanPlaceholders.length - 1}__`;
    });
    const formulaRegex = /(\$\$[\s\S]+?\$\$|\$[^\$]+?\$|\\\[[\s\S]+?\\\]|\\begin\{equation\*?\}[\s\S]+?\\end\{equation\*?\})/g;
    let parts = [], lastIdx = 0, match;
    const formulas = [];
    while ((match = formulaRegex.exec(processed)) !== null) {
        parts.push(processed.substring(lastIdx, match.index));
        formulas.push(match[0]);
        lastIdx = match.index + match[0].length;
    }
    parts.push(processed.substring(lastIdx));
    async function renderFormula(latex, displayMode) {
        try {
            return `<div class="formula-block">${katex.renderToString(latex, { throwOnError: false, displayMode })}</div>`;
        } catch (e) {
            return `<div class="formula-block" style="color:red;">${escapeHtml(latex)}</div>`;
        }
    }
    const rendered = await Promise.all(formulas.map(async f => {
        let latex = '', display = false;
        if (f.startsWith('$$') && f.endsWith('$$')) { latex = f.slice(2, -2).trim(); display = true; }
        else if (f.startsWith('$') && f.endsWith('$') && !f.startsWith('$$')) { latex = f.slice(1, -1).trim(); display = false; }
        else if (f.startsWith('\\[') && f.endsWith('\\]')) { latex = f.slice(2, -2).trim(); display = true; }
        else if (f.includes('\\begin{equation}')) { latex = f.replace(/\\begin\{equation\*?\}/, '').replace(/\\end\{equation\*?\}/, '').trim(); display = true; }
        else { latex = f; display = false; }
        return await renderFormula(latex, display);
    }));
    let finalHtml = '';
    for (let i = 0; i < parts.length; i++) {
        finalHtml += parts[i];
        if (i < rendered.length) finalHtml += rendered[i];
    }
    finalHtml = finalHtml.replace(/__SPAN_PH_(\d+)__/g, (_, idx) => spanPlaceholders[parseInt(idx)] || '');
    return finalHtml;
}
function displayTermsList(terms, container, textContainerId = null) {
    container.innerHTML = '';
    if (!terms.length) {
        container.innerHTML = '<div class="extracted-item"><div class="type">ℹ️ Информация</div><div class="content">Математические термины не обнаружены</div></div>';
        return;
    }
    terms.forEach((termInfo, idx) => {
        const item = document.createElement('div');
        item.className = 'extracted-item';
        item.setAttribute('data-term', termInfo.originalText.toLowerCase());
        item.innerHTML = `
            <div class="type">📐 ${termInfo.lang === 'ru' ? 'Русский' : 'Английский'} математический термин</div>
            <div class="content">${escapeHtml(termInfo.originalText)}</div>
            <div class="context">${escapeHtml(termInfo.definition)}</div>
            <div class="context" style="font-size: 12px; margin-top: 8px;">
                ${termInfo.context ? `📖 Контекст: ${escapeHtml(termInfo.context.substring(0, 200))}...` : ''}
            </div>
        `;
        item.addEventListener('click', () => {
            if (textContainerId) {
                const textContainer = document.getElementById(textContainerId);
                if (textContainer) {
                    const spans = textContainer.querySelectorAll(`.highlight-term[data-term="${termInfo.originalText.toLowerCase()}"]`);
                    if (spans.length > 0) {
                        spans[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                        spans[0].style.backgroundColor = '#ffeb3b';
                        setTimeout(() => {
                            spans[0].style.backgroundColor = '';
                        }, 1500);
                    }
                }
            }
        });
        container.appendChild(item);
    });
}

function setupTextTermClickHandlers(textContainer, listContainer) {
    if (!textContainer) return;
    textContainer.querySelectorAll('.highlight-term').forEach(span => {
        span.removeEventListener('click', span._clickHandler);
        const termText = span.getAttribute('data-term');
        const handler = () => {
            if (listContainer) {
                const targetItem = Array.from(listContainer.children).find(
                    item => item.getAttribute('data-term') === termText
                );
                if (targetItem) {
                    targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetItem.classList.add('active-term');
                    setTimeout(() => targetItem.classList.remove('active-term'), 1500);
                }
            }
        };
        span.addEventListener('click', handler);
        span._clickHandler = handler;
    });
}

async function analyzePdf(file) {
    loadingIndicator.classList.remove('hidden');
    pdfTextBlock.classList.add('hidden');
    pdfAnalysisResults.classList.add('hidden');
    extractedTextWithHighlight.innerHTML = '';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        fullText += pageText + (i < pdf.numPages ? '\n\n' : '');
        document.getElementById('pdfProgressText').textContent = `Обработка страницы ${i} из ${pdf.numPages}`;
    }
    loadingIndicator.classList.add('hidden');

    if (!parserInitialized) {
        extractedTextWithHighlight.innerHTML = escapeHtml(fullText);
        pdfTextBlock.classList.remove('hidden');
        return;
    }

    const termsWithContext = ontomathParser.findTermsInText(fullText);
    const termMap = new Map();
    for (const term of ontomathParser.terms) termMap.set(term.label.toLowerCase(), term);

    let highlighted = highlightTermsInText(fullText, termMap);
    const finalHtml = await renderFormulasInText(highlighted);
    extractedTextWithHighlight.innerHTML = finalHtml;
    pdfTextBlock.classList.remove('hidden');

    displayTermsList(termsWithContext, pdfExtractedList, 'extractedTextWithHighlight');
    setupTextTermClickHandlers(extractedTextWithHighlight, pdfExtractedList);
    pdfAnalysisResults.classList.remove('hidden');

    if (termsWithContext.length) {
        await showRecommendations(termsWithContext, 'recommendationsList', 'recommendationsPanel');
    }

    try {
        await fetch(`${API_URL}/analyze/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: file.name,
                fileSize: file.size,
                terms: termsWithContext.map(t => ({
                    text: t.originalText,
                    definition: t.definition,
                    lang: t.lang,
                    context: t.context
                }))
            })
        });
    } catch (e) { console.warn(e); }
}

uploadButton.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.onchange = async (e) => {
        if (e.target.files[0]) await analyzePdf(e.target.files[0]);
    };
    input.click();
});

const uploadArea = document.querySelector('.upload-area');
if (uploadArea) {
    uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.style.borderColor = '#3a86ff'; });
    uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = '#cbd5e0'; });
    uploadArea.addEventListener('drop', async e => {
        e.preventDefault();
        uploadArea.style.borderColor = '#cbd5e0';
        const file = e.dataTransfer.files[0];
        if (file && file.type === 'application/pdf') await analyzePdf(file);
        else alert('Загрузите PDF');
    });
}
const analyzeButton = document.getElementById('analyzeButton');
const editorTextarea = document.getElementById('manualTextInput');
const extractedList = document.getElementById('extractedList');
const highlightedTextContainer = document.getElementById('highlightedText');
async function analyzeEditorText() {
    const text = editorTextarea.value;
    if (!text.trim()) {
        extractedList.innerHTML = '<div class="extracted-item"><div class="type">ℹ️ Информация</div><div class="content">Введите текст для анализа</div></div>';
        return;
    }
    if (!parserInitialized) {
        alert('Онтология ещё не загружена');
        return;
    }
    const terms = ontomathParser.findTermsInText(text);
    displayTermsList(terms, extractedList, null);
    if (terms.length) {
        await showRecommendations(terms, 'editorRecommendationsList', 'editorRecommendationsPanel');
    }
}
if (analyzeButton) analyzeButton.addEventListener('click', analyzeEditorText);
if (editorTextarea) editorTextarea.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'Enter') analyzeEditorText();
});


document.querySelectorAll('.oval[data-panel]').forEach(oval => {
    oval.addEventListener('click', () => {
        const panel = oval.dataset.panel;
        const uploadPanel = document.getElementById('uploadPanel');
        const editorPanel = document.getElementById('editorPanel');
        if (uploadPanel) uploadPanel.classList.toggle('hidden', panel !== 'upload');
        if (editorPanel) editorPanel.classList.toggle('hidden', panel !== 'editor');
    });
});


const askBtn = document.getElementById('askLlmBtn');
const llmQuestion = document.getElementById('llmQuestion');
const llmAnswerText = document.getElementById('llmAnswerText');

if (askBtn) {
    askBtn.addEventListener('click', async () => {
        const question = llmQuestion.value.trim();
        if (!question) {
            llmAnswerText.innerHTML = 'Введите вопрос.';
            return;
        }
        llmAnswerText.innerHTML = ' Думаю...';
        try {
            const response = await fetch(`${API_URL}/llm/ask`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question })
            });
            const data = await response.json();
            if (data.error) {
                llmAnswerText.innerHTML = `Ошибка: ${data.error}`;
            } else if (data.answer) {
                llmAnswerText.innerHTML = data.answer;

                if (data.term) {
                    console.log(`Найден термин: ${data.term}`);
                }
            } else {
                llmAnswerText.innerHTML = 'Не удалось получить ответ.';
            }
        } catch (err) {
            console.error(err);
            llmAnswerText.innerHTML = 'Ошибка соединения с сервером. Убедитесь, что бэкенд запущен.';
        }
    });
}

const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const icon = themeToggle.querySelector('.icon');
        if (icon) icon.textContent = document.body.classList.contains('dark-mode') ? '☀️' : '🌙';
    });
}
async function showRecommendations(termsList, listContainerId, panelId) {
    if (!termsList || !termsList.length) return;
    const panel = document.getElementById(panelId);
    const listContainer = document.getElementById(listContainerId);
    if (!panel || !listContainer) return;

    try {
        const response = await fetch(`${API_URL}/ai/recommend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ terms: termsList.map(t => t.originalText) })
        });
        const data = await response.json();
        if (data.recommendations && data.recommendations.length) {
            listContainer.innerHTML = '';
            data.recommendations.forEach(rec => {
                const item = document.createElement('div');
                item.className = 'recommendation-item';
                item.innerHTML = `
                    <div class="filename">📄 ${escapeHtml(rec.filename)}</div>
                    <div class="match-count">Совпадений терминов: ${rec.match_count}</div>
                `;
                item.addEventListener('click', () => {
                    showFileDetails(rec.id, 'relatedDocumentsList', 'relatedDocumentsTitle');
                });
                listContainer.appendChild(item);
            });
            panel.classList.remove('hidden');
        } else {
            panel.classList.add('hidden');
        }
    } catch (err) {
        console.error('Ошибка получения рекомендаций:', err);
        panel.classList.add('hidden');
    }
}

async function showFileDetails(fileId, listId, titleId) {
    try {
        const filesRes = await fetch(`${API_URL}/files/all`);
        const filesData = await filesRes.json();
        const currentFile = filesData.files.find(f => f.id == fileId);
        const fileName = currentFile?.filename || `Файл ID ${fileId}`;

        const connRes = await fetch(`${API_URL}/graph/file/${fileId}/connections`);
        const { connections, fileNames } = await connRes.json();

        const panel = document.getElementById('relatedDocumentsPanel');
        const titleEl = document.getElementById(titleId);
        const listEl = document.getElementById(listId);
        if (!panel || !listEl) return;

        titleEl.textContent = `📄 Связанные документы для: ${fileName}`;
        listEl.innerHTML = '';

        if (connections.length === 0) {
            listEl.innerHTML = '<div class="extracted-item">🔗 Нет связанных документов</div>';
        } else {
            for (const conn of connections) {
                const targetFileName = fileNames[conn.connected_file_id] || `ID ${conn.connected_file_id}`;
                const termListHtml = conn.common_terms_list?.length
                    ? `<div class="terms-list"><strong>📖 Общие термины (${conn.common_terms_list.length}):</strong><ul>${conn.common_terms_list.map(term => `<li>${escapeHtml(term)}</li>`).join('')}</ul></div>`
                    : '';
                const item = document.createElement('div');
                item.className = 'related-item';
                item.innerHTML = `
                    <div class="filename">📄 ${escapeHtml(targetFileName)}</div>
                    <div class="common-count">🔗 Общих терминов: ${conn.common_terms_count}</div>
                    ${termListHtml}
                `;
                listEl.appendChild(item);
            }
        }
        panel.classList.remove('hidden');
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
        console.error('Ошибка загрузки связей:', err);
        const panel = document.getElementById('relatedDocumentsPanel');
        if (panel) {
            panel.classList.remove('hidden');
            document.getElementById(listId).innerHTML = '<div class="extracted-item"> Не удалось загрузить связи</div>';
        }
    }
}


loadOntology();
document.getElementById('uploadPanel').classList.remove('hidden');
document.getElementById('editorPanel').classList.add('hidden');