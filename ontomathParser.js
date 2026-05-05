
class OntoMathParser {
    constructor() {
        this.terms = [];
        this.termMap = new Map();
        this.initialized = false;
    }

    async loadFromFile(omnContent) {
        try {
            this.parseOmn(omnContent);
            this.buildTermMap();
            this.initialized = true;
            const stats = this.getStats();
            console.log(`OntoMathParser: загружено ${this.terms.length} терминов`);
            console.log(`Из них с определениями: ${stats.termsWithDefinition}`);
            if (this.terms.length === 0) {
                console.warn('Онтология не содержит терминов с rdfs:label.');
            }
        } catch (e) {
            console.error('Ошибка парсинга онтологии OntoMathPRO:', e);
            this.initialized = false;
            this.terms = [];
            this.termMap.clear();
        }
    }

    parseOmn(content) {
        const lines = content.split('\n');
        let currentClass = null;
        let inAnnotations = false;
        let currentAnnotations = [];

        // Регулярные выражения
        const labelRegex = /rdfs:label\s+"([^"]+)"@([a-z]+)/;
        const commentRegex = /rdfs:comment\s+"([^"]+)"(?:@([a-z]+))?(?:\^\^xsd:string)?/;
        const uriRegex = /Class:\s*([^\s\(]+)/;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (line === '') continue;

            // Начало нового класса
            if (line.startsWith('Class:')) {
                if (currentClass) {
                    this.addClassTerms(currentClass);
                }
                const uriMatch = line.match(uriRegex);
                const uri = uriMatch ? uriMatch[1] : '';
                currentClass = {
                    uri: uri,
                    labels: [],
                    comments: [],
                    annotations: []
                };
                inAnnotations = false;
                currentAnnotations = [];
                continue;
            }

            if (!currentClass) continue;

            if (line === 'Annotations:' || line.startsWith('Annotations:')) {
                inAnnotations = true;
                continue;
            }

            if (inAnnotations && (line.startsWith('rdfs:') || line.startsWith('owl:'))) {
                currentAnnotations.push(line);

                if (line.endsWith(',')) {
                    continue;
                } else {
                    this.parseAnnotationsBlock(currentAnnotations, currentClass);
                    inAnnotations = false;
                    currentAnnotations = [];
                }
            }

            const labelMatch = line.match(labelRegex);
            if (labelMatch) {
                currentClass.labels.push({
                    text: labelMatch[1],
                    lang: labelMatch[2]
                });
            }

            const commentMatch = line.match(commentRegex);
            if (commentMatch) {
                currentClass.comments.push({
                    text: commentMatch[1],
                    lang: commentMatch[2] || null   
                });
            }
        }

        if (currentClass) {
            this.addClassTerms(currentClass);
        }

        this.extractAllComments(content);
    }

    parseAnnotationsBlock(annotations, currentClass) {
        const fullBlock = annotations.join(' ');

        const labelRegex = /rdfs:label\s+"([^"]+)"@([a-z]+)/g;
        let labelMatch;
        while ((labelMatch = labelRegex.exec(fullBlock)) !== null) {
            currentClass.labels.push({
                text: labelMatch[1],
                lang: labelMatch[2]
            });
        }

        const commentRegex = /rdfs:comment\s+"([^"]+)"(?:@([a-z]+))?(?:\^\^xsd:string)?/g;
        let commentMatch;
        while ((commentMatch = commentRegex.exec(fullBlock)) !== null) {
            currentClass.comments.push({
                text: commentMatch[1],
                lang: commentMatch[2]
            });
        }
    }

    extractAllComments(content) {
        const multilinePattern = /rdfs:comment\s+"((?:[^"\\]|\\.)*)"(?:@([a-z]+))?(?:\^\^xsd:string)?/gs;
        let match;

        const tempComments = [];

        while ((match = multilinePattern.exec(content)) !== null) {
            let commentText = match[1];
            commentText = commentText.replace(/\s+/g, ' ').trim();
            const lang = match[2];

            const beforeContent = content.substring(0, match.index);
            const lastClassIndex = beforeContent.lastIndexOf('Class:');

            if (lastClassIndex !== -1) {
                const classLine = beforeContent.substring(lastClassIndex);
                const uriMatch = classLine.match(/Class:\s*([^\s\(]+)/);
                if (uriMatch) {
                    tempComments.push({
                        uri: uriMatch[1],
                        text: commentText,
                        lang: lang  
                    });
                }
            }
        }

        for (const term of this.terms) {
            const matchingComment = tempComments.find(c => c.uri === term.uri && c.lang === term.lang);
            if (matchingComment && (!term.definition || term.definition === '')) {
                term.definition = matchingComment.text;
            }
        }
    }

    addClassTerms(cls) {
        for (const label of cls.labels) {
            let definition = '';
            if (cls.comments.length > 0) {
                let commentForLang = cls.comments.find(c => c.lang === label.lang);
                if (commentForLang && commentForLang.text) {
                    definition = commentForLang.text;
                } else {
                    const anyComment = cls.comments.find(c => c.text);
                    if (anyComment) {
                        definition = anyComment.text;
                    }
                }
            }

            if (!definition || definition.trim() === '') {
                definition = 'Определение отсутствует';
            }

            this.terms.push({
                label: label.text,
                lang: label.lang,
                definition: definition,
                uri: cls.uri
            });
        }
    }

    buildTermMap() {
        this.termMap.clear();
        for (const term of this.terms) {
            const key = term.label.toLowerCase();
            if (!this.termMap.has(key)) {
                this.termMap.set(key, term);
            }
        }
    }
    isWordChar(ch) {
        if (!ch.length) return false;
        const code = ch.charCodeAt(0);
        return /[a-zA-Zа-яА-ЯёЁ0-9_\-']/.test(ch);
    }

    findTermsInText(text, contextSize = 50) {
        if (!this.initialized) {
            console.warn('OntoMathParser не инициализирован.');
            return [];
        }

        const results = [];
        const usedTerms = new Set();

        const isWordChar = this.isWordChar.bind(this);
        const lowerText = text.toLowerCase();

        const sortedKeys = [...this.termMap.keys()].sort((a, b) => b.length - a.length);

        for (const key of sortedKeys) {
            if (usedTerms.has(key)) continue;

            let searchIndex = 0;
            let index = lowerText.indexOf(key, searchIndex);

            while (index !== -1) {
                const beforeChar = index > 0 ? text[index - 1] : '';
                const afterChar = index + key.length < text.length ? text[index + key.length] : '';

                const isBeforeBoundary = !isWordChar(beforeChar);
                const isAfterBoundary = !isWordChar(afterChar);
                const isWholeWord = isBeforeBoundary && isAfterBoundary;

                if (isWholeWord) {
                    const term = this.termMap.get(key);

                    const start = Math.max(0, index - contextSize);
                    const end = Math.min(text.length, index + key.length + contextSize);
                    const context = text.substring(start, end);

                    results.push({
                        originalText: term.label,
                        definition: term.definition || 'Определение отсутствует',
                        lang: term.lang,
                        context: context,
                        uri: term.uri || ''
                    });
                    usedTerms.add(key);
                    break; 
                }
                searchIndex = index + 1;
                index = lowerText.indexOf(key, searchIndex);
            }
        }

        return results;
    }

    isLetter(ch) {
        return (ch >= 'a' && ch <= 'z') ||
            (ch >= 'A' && ch <= 'Z') ||
            (ch >= 'а' && ch <= 'я') ||
            (ch >= 'А' && ch <= 'Я');
    }

    getStats() {
        const byLang = {};
        let termsWithDefinition = 0;

        for (const term of this.terms) {
            byLang[term.lang] = (byLang[term.lang] || 0) + 1;
            if (term.definition && term.definition !== 'Определение отсутствует') {
                termsWithDefinition++;
            }
        }
        return {
            totalTerms: this.terms.length,
            termsWithDefinition: termsWithDefinition,
            byLang
        };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OntoMathParser };
}