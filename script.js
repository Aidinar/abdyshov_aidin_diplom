
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    themeIcon.textContent = isDark ? '☀️' : '🌙';
    themeToggle.setAttribute('aria-pressed', isDark);
}

themeToggle.addEventListener('click', toggleTheme);

// === Настройка API ===
const API_URL = 'http://localhost:3001/api';

// === Переключение панелей ===
const uploadPanel = document.getElementById('uploadPanel');
const editorPanel = document.getElementById('editorPanel');
const ovals = document.querySelectorAll('.oval[data-panel]');

function showPanel(panelName) {
    if (panelName === 'upload') {
        uploadPanel.classList.remove('hidden');
        editorPanel.classList.add('hidden');
    } else if (panelName === 'editor') {
        uploadPanel.classList.add('hidden');
        editorPanel.classList.remove('hidden');
    }
}

ovals.forEach(oval => {
    oval.addEventListener('click', () => showPanel(oval.dataset.panel));
});

// === Настройка pdf.js ===
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// === Элементы DOM ===
const uploadButton = document.getElementById('uploadPdfButton');
const loadingIndicator = document.getElementById('pdfLoadingIndicator');
const pdfResults = document.getElementById('pdfResults');
const pdfAnalysisResults = document.getElementById('pdfAnalysisResults');
const extractedPdfText = document.getElementById('extractedPdfText');
const pageCountSpan = document.getElementById('pageCount');
const charCountSpan = document.getElementById('charCount');
const analyzePdfButton = document.getElementById('analyzePdfButton');
const pdfExtractedList = document.getElementById('pdfExtractedList');
const pdfHighlightedContainer = document.getElementById('pdfHighlightedContainer');
const pdfHighlightedText = document.getElementById('pdfHighlightedText');

let currentPdfText = '';
let currentFileName = '';
let currentFileSize = null;

// === Инициализация OntoMathParser ===
const ontomathParser = new OntoMathParser();
let parserInitialized = false;

// === Загрузка онтологии ===
async function loadOntoMathPro() {
    try {
        showNotification('Загрузка онтологии OntoMathPRO...', 'info');
        const response = await fetch('OntoMathPro.omn');
        if (!response.ok) throw new Error(`Файл не найден (${response.status})`);
        const omnContent = await response.text();
        await ontomathParser.loadFromFile(omnContent);
        parserInitialized = true;
        const stats = ontomathParser.getStats();
        showNotification(`✓ Онтология загружена: ${stats.totalTerms} терминов`, 'success');

        setTimeout(() => {
            if (editorTextarea && editorTextarea.value.trim()) {
                analyzeMathText(editorTextarea.value, extractedList, editorTextarea, highlightedText);
            }
        }, 500);
    } catch (error) {
        console.error('Ошибка загрузки онтологии:', error);
        showNotification('✗ Онтология не загружена', 'error');
        parserInitialized = false;
    }
}

// === HTML экранирование ===
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// === Подсветка терминов ===
function highlightTermsInText(text, terms) {
    if (!terms || !terms.length) return escapeHtml(text);

    const sortedTerms = [...terms].sort((a, b) => b.originalText.length - a.originalText.length);
    const pattern = sortedTerms.map(t => t.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const termMap = new Map();
    sortedTerms.forEach(t => termMap.set(t.originalText.toLowerCase(), t));

    const regex = new RegExp(`(${pattern})`, 'gi');
    const parts = text.split(regex);

    let result = '';
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i % 2 === 1) {
            const lowerPart = part.toLowerCase();
            const termInfo = termMap.get(lowerPart);
            const original = termInfo ? termInfo.originalText : part;
            const definition = termInfo ? termInfo.definition : '';
            const escapedDef = escapeHtml(definition).replace(/"/g, '&quot;');
            result += `<span class="highlight-term" data-term="${escapeHtml(original.toLowerCase())}" title="${escapedDef}">${escapeHtml(original)}</span>`;
        } else {
            result += escapeHtml(part);
        }
    }
    return result;
}

// === Отображение списка терминов ===
function displayTermsList(terms, targetElement, sourceElement = null, highlightElement = null) {
    targetElement.innerHTML = '';

    if (terms.length === 0) {
        targetElement.innerHTML = '<div class="extracted-item"><div class="type">ℹ️ Информация</div><div class="content">Математические термины не обнаружены</div></div>';
        if (highlightElement) highlightElement.innerHTML = '<p>Термины не найдены</p>';
        return;
    }

    terms.forEach(termInfo => {
        const item = document.createElement('div');
        item.className = 'extracted-item ontomath-term';
        item.dataset.term = termInfo.originalText;
        item.innerHTML = `
            <div class="type">📐 ${termInfo.lang === 'ru' ? 'Русский' : 'Английский'} математический термин</div>
            <div class="content">${escapeHtml(termInfo.originalText)}</div>
            <div class="context">${escapeHtml(termInfo.definition)}</div>
            <div class="context" style="font-size: 12px; margin-top: 8px;">
                ${termInfo.context ? `📖 Контекст: ${escapeHtml(termInfo.context.substring(0, 200))}...` : ''}
            </div>
        `;

        if (sourceElement || highlightElement) {
            item.addEventListener('click', () => {
                if (sourceElement) highlightInTextarea(termInfo.originalText, sourceElement);
                if (highlightElement) highlightTermInHighlighted(termInfo.originalText, highlightElement);
            });
            item.style.cursor = 'pointer';
        }

        targetElement.appendChild(item);
    });
}

// === Выделение термина ===
function highlightInTextarea(term, textarea) {
    if (!textarea) return;
    const text = textarea.value;
    const index = text.toLowerCase().indexOf(term.toLowerCase());
    if (index !== -1) {
        textarea.focus();
        textarea.setSelectionRange(index, index + term.length);
    }
}

function highlightTermInHighlighted(term, container) {
    if (!container) return;
    const active = container.querySelector('.highlight-term.active');
    if (active) active.classList.remove('active');

    const spans = container.querySelectorAll('.highlight-term');
    for (let span of spans) {
        if (span.textContent.toLowerCase() === term.toLowerCase()) {
            span.classList.add('active');
            span.scrollIntoView({ behavior: 'smooth', block: 'center' });
            break;
        }
    }
}

// === Анализ текста ===
async function analyzeMathText(text, targetElement, sourceElement = null, highlightElement = null) {
    if (!text.trim()) {
        targetElement.innerHTML = '<div class="extracted-item">Введите текст для анализа</div>';
        if (highlightElement) highlightElement.innerHTML = '';
        return;
    }

    targetElement.innerHTML = '<div class="extracted-item"><div class="type">🔍 Поиск терминов...</div><div class="content">Анализ текста...</div></div>';

    await new Promise(resolve => setTimeout(resolve, 300));

    const foundTerms = ontomathParser.findTermsInText(text);
    displayTermsList(foundTerms, targetElement, sourceElement, highlightElement);

    if (highlightElement && foundTerms.length > 0) {
        highlightElement.innerHTML = highlightTermsInText(text, foundTerms);
        highlightElement.__terms = foundTerms;
    } else if (highlightElement) {
        highlightElement.innerHTML = '<p>Термины не найдены</p>';
    }

    if (foundTerms.length > 0) {
        await showRecommendations(foundTerms);
    } else {
        const panel = document.getElementById('recommendationsPanel');
        if (panel) panel.style.display = 'none';
    }
}

// === Уведомления ===
function showNotification(message, type = 'info') {
    let notification = document.querySelector('.notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.className = 'notification';
        document.body.appendChild(notification);
    }
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.display = 'block';
    setTimeout(() => { notification.style.display = 'none'; }, 3000);
}

// === СОХРАНЕНИЕ В POSTGRESQL (БЭКЕНД) ===
async function saveToDatabase(filename, terms, fileSize = null) {
    try {
        showNotification('💾 Сохранение в базу данных...', 'info');

        const response = await fetch(`${API_URL}/analyze/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: filename,
                fileSize: fileSize,
                terms: terms.map(t => ({
                    text: t.originalText,
                    definition: t.definition,
                    lang: t.lang,
                    context: t.context
                }))
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка сервера');
        }

        const data = await response.json();
        showNotification(`Сохранено в БД: ${data.totalTerms} терминов`, 'success');
        return data;

    } catch (error) {
        console.error('Ошибка сохранения:', error);
        showNotification(` Ошибка: ${error.message}`, 'error');
        return null;
    }
}

// === ПОЛУЧЕНИЕ СТАТИСТИКИ ===
async function loadStats() {
    try {
        const response = await fetch(`${API_URL}/stats`);
        if (!response.ok) throw new Error('Ошибка загрузки');
        const stats = await response.json();
        displayStats(stats);
        return stats;
    } catch (error) {
        console.error('Ошибка статистики:', error);
        showNotification('Не удалось загрузить статистику', 'error');
    }
}

function displayStats(stats) {
    console.log(' Статистика сервера:', stats);
    showNotification(` Всего файлов: ${stats.total_files}, терминов: ${stats.total_terms}`, 'info');
}

// === ПОЛУЧЕНИЕ ИСТОРИИ ===
async function loadHistory() {
    try {
        const response = await fetch(`${API_URL}/files/history?limit=10`);
        if (!response.ok) throw new Error('Ошибка загрузки');
        const data = await response.json();
        displayHistory(data.files);
        return data.files;
    } catch (error) {
        console.error('Ошибка истории:', error);
    }
}

function displayHistory(files) {
    if (!files || files.length === 0) {
        console.log('История пуста');
        return;
    }

    console.log(' История анализов:');
    files.forEach(file => {
        console.log(`   - ${file.filename} (${file.total_terms} терминов) - ${new Date(file.upload_date).toLocaleDateString()}`);
    });
}

// === ИЗВЛЕЧЕНИЕ ТЕКСТА ИЗ PDF ===
async function extractTextFromPDF(file) {
    try {
        currentFileName = file.name;
        currentFileSize = file.size;

        loadingIndicator.classList.remove('hidden');
        pdfResults.classList.add('hidden');
        pdfAnalysisResults.classList.add('hidden');
        pdfHighlightedContainer.classList.add('hidden');

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const numPages = pdf.numPages;
        pageCountSpan.textContent = `Страниц: ${numPages}`;

        let fullText = '';
        for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n\n';
            document.getElementById('pdfProgressText').textContent = `Обработка: страница ${i} из ${numPages}`;
        }

        currentPdfText = fullText;
        extractedPdfText.textContent = fullText;
        charCountSpan.textContent = `Символов: ${fullText.length}`;

        loadingIndicator.classList.add('hidden');
        pdfResults.classList.remove('hidden');

        showNotification(`PDF загружен: ${fullText.length} символов`, 'success');
        return fullText;

    } catch (error) {
        console.error('Ошибка:', error);
        loadingIndicator.classList.add('hidden');
        showNotification('Ошибка при обработке PDF', 'error');
    }
}

// === Обработчики событий ===
uploadButton.addEventListener('click', () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.pdf';
    fileInput.onchange = (e) => {
        if (e.target.files[0]) extractTextFromPDF(e.target.files[0]);
    };
    fileInput.click();
});

analyzePdfButton.addEventListener('click', async () => {
    if (!currentPdfText) {
        showNotification('Сначала загрузите PDF', 'error');
        return;
    }

    if (!parserInitialized) {
        showNotification('Онтология загружается, подождите...', 'warning');
        return;
    }

    pdfAnalysisResults.classList.remove('hidden');
    pdfHighlightedContainer.classList.remove('hidden');

    showNotification('🔍 Анализ документа...', 'info');

    const foundTerms = ontomathParser.findTermsInText(currentPdfText);

    displayTermsList(foundTerms, pdfExtractedList, null, pdfHighlightedText);

    const highlightedHtml = highlightTermsInText(currentPdfText, foundTerms);
    pdfHighlightedText.innerHTML = highlightedHtml;
    pdfHighlightedText.__terms = foundTerms;

    if (foundTerms.length > 0) {
        //  СОХРАНЕНИЕ В POSTGRESQL
        await saveToDatabase(currentFileName, foundTerms, currentFileSize);
        await showRecommendations(foundTerms);
        setTimeout(() => loadStats(), 500);
    } else {
        showNotification('Термины не найдены', 'info');
    }
});

// === Редактор текста ===
const analyzeButton = document.getElementById('analyzeButton');
const editorTextarea = document.getElementById('manualTextInput');
const extractedList = document.getElementById('extractedList');
const highlightedText = document.getElementById('highlightedText');

analyzeButton.addEventListener('click', () => {
    analyzeMathText(editorTextarea.value, extractedList, editorTextarea, highlightedText);
});

editorTextarea.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
        analyzeMathText(editorTextarea.value, extractedList, editorTextarea, highlightedText);
    }
});

// === Drag & drop для PDF ===
const uploadArea = document.querySelector('.upload-area');
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#3a86ff';
});
uploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#cbd5e0';
});
uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#cbd5e0';
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
        extractTextFromPDF(file);
    } else {
        showNotification('Загрузите PDF файл', 'error');
    }
});

// === Плавный скролл ===
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
});

// === Настройка кликов на подсвеченные термины ===
function setupHighlightClickHandlers() {
    const containers = [highlightedText, pdfHighlightedText];
    containers.forEach(container => {
        if (container) {
            container.addEventListener('click', (e) => {
                const target = e.target.closest('.highlight-term');
                if (target) {
                    const termText = target.textContent;
                    const terms = container.__terms;
                    if (terms) {
                        const termInfo = terms.find(t => t.originalText.toLowerCase() === termText.toLowerCase());
                        if (termInfo) {
                            showNotification(termInfo.definition, 'info');
                        }
                    }
                }
            });
        }
    });
}

// === Запуск ===
document.addEventListener('DOMContentLoaded', async () => {
    await loadOntoMathPro();
    setupHighlightClickHandlers();

    try {
        const response = await fetch(`${API_URL}/health`);
        if (response.ok) {
            console.log(' Бэкенд доступен');
            showNotification('Соединение с сервером установлено', 'success');
            await loadStats();
        }
    } catch (error) {
        console.warn(' Бэкенд недоступен:', error.message);
        showNotification('Сервер БД не запущен. Запустите бэкенд.', 'warning');
    }
});



async function showFileDetails(fileId) {
    try {
        const filesRes = await fetch(`${API_URL}/files/all`);
        const filesData = await filesRes.json();
        const currentFile = filesData.files.find(f => f.id == fileId);
        const fileName = currentFile?.filename || `Файл ID ${fileId}`;

        const connRes = await fetch(`${API_URL}/graph/file/${fileId}/connections`);
        const { connections, fileNames } = await connRes.json();

        const panel = document.getElementById('relatedDocumentsPanel');
        const titleEl = document.getElementById('relatedDocumentsTitle');
        const listEl = document.getElementById('relatedDocumentsList');

        if (!panel || !listEl) return;

        titleEl.textContent = `📄 Связанные документы для: ${fileName}`;
        listEl.innerHTML = '';

        if (connections.length === 0) {
            listEl.innerHTML = '<div class="extracted-item"> Нет связанных документов</div>';
        } else {
            for (const conn of connections) {
                const targetFileName = fileNames[conn.connected_file_id] || `ID ${conn.connected_file_id}`;

                const termListHtml = conn.common_terms_list?.length
                    ? `<div class="term-list">
                         <strong>📖 Общие термины (${conn.common_terms_list.length}):</strong>
                         <ul>
                           ${conn.common_terms_list.map(term => `<li>${escapeHtml(term)}</li>`).join('')}
                         </ul>
                       </div>`
                    : '';

                const item = document.createElement('div');
                item.className = 'extracted-item';
                item.innerHTML = `
                    <div class="content" style="font-weight:600;">📄 ${escapeHtml(targetFileName)}</div>
                    <div class="context"> Общих терминов: ${conn.common_terms_count}</div>
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
            document.getElementById('relatedDocumentsList').innerHTML = '<div class="extracted-item">❌ Не удалось загрузить связи</div>';
        }
    }
}

async function showRecommendations(termsList) {
    if (!termsList.length) return;
    const panel = document.getElementById('recommendationsPanel');
    const listContainer = document.getElementById('recommendationsList');
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
                    <div class="filename">📄 ${rec.filename}</div>
                    <div class="match-count">Совпадений терминов: ${rec.match_count}</div>
                `;
                item.addEventListener('click', () => {
                    showFileDetails(rec.id); 
                    showNotification(`Выбран документ: ${rec.filename}`, 'info');
                });
                listContainer.appendChild(item);
            });
            panel.style.display = 'block';
        } else {
            panel.style.display = 'none';
        }
    } catch (err) {
        console.error('Ошибка получения рекомендаций:', err);
        panel.style.display = 'none';
    }
}

