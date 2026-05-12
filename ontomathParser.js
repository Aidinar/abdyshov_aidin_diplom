class OntoMathParser {
    constructor() {
        this.terms = [];
        this.termMap = new Map();
        this.initialized = false;
    }
    loadFromJSON(termsData) {
        try {
            this.terms = termsData.map(item => ({
                label: item.label,
                lang: item.lang,
                definition: item.definition,
                uri: item.uri
            }));
            this.buildTermMap();
            this.initialized = true;
            const stats = this.getStats();
            console.log(`OntoMathParser: загружено ${this.terms.length} терминов из GraphDB`);
            console.log(`Из них с определениями: ${stats.termsWithDefinition}`);
            return true;
        } catch (e) {
            console.error('Ошибка загрузки JSON-онтологии:', e);
            this.initialized = false;
            return false;
        }
    }

    buildTermMap() {
        this.termMap.clear();
        for (const term of this.terms) {
            const key = term.label.toLowerCase();
            if (!this.termMap.has(key)) {
                this.termMap.set(key, term);
            } else {
                const existing = this.termMap.get(key);
                if (term.lang === 'ru' && existing.lang !== 'ru') {
                    this.termMap.set(key, term);
                }
            }
        }
    }

    isWordChar(ch) {
        if (!ch.length) return false;
        return /[a-zA-Zа-яА-ЯёЁ0-9_\-']/.test(ch);
    }

    findTermsInText(text, contextSize = 50) {
        if (!this.initialized) {
            console.warn('OntoMathParser не инициализирован.');
            return [];
        }

        const results = [];
        const usedTerms = new Set();
        const lowerText = text.toLowerCase();
        const sortedKeys = [...this.termMap.keys()].sort((a, b) => b.length - a.length);

        for (const key of sortedKeys) {
            if (usedTerms.has(key)) continue;

            let searchIndex = 0;
            let index = lowerText.indexOf(key, searchIndex);
            while (index !== -1) {
                const beforeChar = index > 0 ? text[index - 1] : '';
                const afterChar = index + key.length < text.length ? text[index + key.length] : '';

                const isBeforeBoundary = !this.isWordChar(beforeChar);
                const isAfterBoundary = !this.isWordChar(afterChar);
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
            termsWithDefinition,
            byLang
        };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OntoMathParser };
}