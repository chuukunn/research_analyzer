document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('canvas');
    const addParagraphBtn = document.getElementById('add-paragraph-btn');
    
    // --- Template Dropdown Elements ---
    const templateDropdownContainer = document.getElementById('template-dropdown-container');
    const addFolderDropdownBtn = document.getElementById('add-folder-dropdown-btn');
    const templateDropdownMenu = document.getElementById('template-dropdown-menu');
    const addSingleFolderBtn = document.getElementById('add-single-folder-btn');

    // --- Panel Collapse Elements ---
    const collapseBtn = document.getElementById('collapse-editor-btn');
    const panelLeft = document.getElementById('panel-left');
    const panelRight = document.getElementById('panel-right');
    const collapseIconOpen = document.getElementById('collapse-icon-open');
    const collapseIconClosed = document.getElementById('collapse-icon-closed');

    // --- Template Definitions ---
    const TEMPLATES = {
        A: ['導入（受賞理由と生い立ち）', '経歴（キャリア形成の道のり）', '主要な業績', '影響と後世への功績', '総括（人物像と遺産）'],
        B: ['導入', '業績1', '業績2', '総括'],
        C: ['導入', '背景と着想', '理論の構築と展開', '応用と影響', '総括']
    };

    // --- Utility Functions (unchanged) ---

    function autoResizeTextarea() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    }

    function createYearDistChart(container, yearData) {
        if (!yearData || yearData.length === 0) {
            container.innerHTML = "<p>年代分布データがありません。</p>";
            return;
        };
        const margin = {top: 10, right: 10, bottom: 35, left: 30};
        const containerWidth = container.getBoundingClientRect().width || 300;
        const width = containerWidth - margin.left - margin.right;
        const height = 120 - margin.top - margin.bottom;
        const svg = d3.select(container).append("svg")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);
        const x = d3.scaleBand().domain(yearData.map(d => d[0])).range([0, width]).padding(0.2);
        const y = d3.scaleLinear().domain([0, d3.max(yearData, d => d[1])]).range([height, 0]);
        svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).tickValues(x.domain().filter((d,i) => !(i%5) || i === x.domain().length - 1))).selectAll("text").style("text-anchor", "end").attr("dx", "-.8em").attr("dy", ".15em").attr("transform", "rotate(-65)");
        svg.append("g").call(d3.axisLeft(y).ticks(Math.min(5, d3.max(yearData, d => d[1]))));
        svg.selectAll(".bar").data(yearData).enter().append("rect").attr("class", "bar").attr("x", d => x(d[0])).attr("y", d => y(d[1])).attr("width", x.bandwidth()).attr("height", d => height - y(d[1])).attr("fill", "#6366f1").append("title").text(d => `${d[0]}年: ${d[1]}件`);
    }

    function highlightKeywords(abstractText, keywords) {
        if (!keywords || keywords.length === 0 || !abstractText) return abstractText;
        const sortedKeywords = [...new Set(keywords)].sort((a, b) => b.length - a.length);
        const regex = new RegExp(`\\b(${sortedKeywords.map(kw => kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})\\b`, 'gi');
        return abstractText.replace(regex, '<strong>$1</strong>');
    }

    // --- Core Block Creation Function ---

    function createBlockElement(data) {
        const component = document.createElement('div');
        component.className = 'component'; // Class for SortableJS to find

        let headerHtml = '';
        let bodyHtml = '';

        const controlsHtml = `
            <div class="flex items-center space-x-1">
                <button class="drag-handle cursor-move p-1 text-slate-400 hover:text-slate-600" title="移動">
                    <span style="font-size: 1.2em; line-height: 1;">☰</span>
                </button>
                <button class="toggle-collapse-btn text-slate-500 hover:text-slate-700 text-lg p-1" title="折りたたむ">－</button>
                <button class="delete-btn text-slate-400 hover:text-slate-600 text-lg p-1" title="削除">×</button>
            </div>
        `;

        switch (data.type) {
            case 'paragraph':
                headerHtml = `<input type="text" class="font-semibold text-sm bg-transparent focus:bg-white focus:ring-1 focus:ring-indigo-500 rounded p-1 w-full" value="${data.name || '新しいパラグラフ'}">`;
                bodyHtml = `<div class="component-body p-2">
                                <textarea class="prose-textarea auto-resize-textarea" placeholder="ここに本文を入力..."></textarea>
                            </div>`;
                break;
            case 'folder':
                headerHtml = `<input type="text" class="font-semibold text-sm bg-transparent focus:bg-white focus:ring-1 focus:ring-indigo-500 rounded p-1 w-full" value="${data.name || '新しいフォルダー'}">`;
                bodyHtml = `<div class="component-children-container min-h-[40px] bg-slate-50 p-2 rounded-b-md border-t"></div>`;
                break;
            case 'author':
                headerHtml = `<h3 class="font-semibold text-sm truncate pr-2" title="${data.name}">${data.name}</h3>`;
                const authorBody = `<div class="prose prose-sm max-w-none"><p><strong>共著論文数:</strong> ${data.stats.coauthorCount}件</p><p><strong>最も多い共著トピック:</strong> ${data.stats.mostFrequentTopic}</p></div>`;
                bodyHtml = `<div class="component-body p-2">${authorBody}</div><div class="component-memo p-2 border-t border-slate-200 bg-slate-50 rounded-b-md"><textarea class="prose-textarea auto-resize-textarea" placeholder="ここにメモを入力..."></textarea></div>`;
                break;
            case 'topic':
                headerHtml = `<h3 class="font-semibold text-sm truncate pr-2" title="${data.name}">${data.name}</h3>`;
                const topPapersHtml = data.details.topCitedPapers.length > 0 ? data.details.topCitedPapers.map(p => `<li>${p.title} (${p.year}) - <strong>${p.cit_cnt} citations</strong></li>`).join('') : '<li>該当する論文はありません。</li>';
                const topicBody = `<div class="prose prose-sm max-w-none"><p><strong>トピックキーワード:</strong> ${data.details.keywords}</p><hr><p><strong>引用数トップ3論文:</strong></p><ol>${topPapersHtml}</ol><hr><p><strong>論文の年代分布:</strong></p><div class="year-chart-container" style="width: 100%;"></div></div>`;
                bodyHtml = `<div class="component-body p-2">${topicBody}</div><div class="component-memo p-2 border-t border-slate-200 bg-slate-50 rounded-b-md"><textarea class="prose-textarea auto-resize-textarea" placeholder="ここにメモを入力..."></textarea></div>`;
                break;
            case 'paper':
                headerHtml = `<h3 class="font-semibold text-sm truncate pr-2 hover:text-indigo-600 hover:underline cursor-pointer" title="${data.details.title}" data-paper-id="${data.details.paper_id}">${data.details.title}</h3>`;
                const highlightedAbstract = highlightKeywords(data.details.abstract, data.details.keywords);
                const paperBody = `<div class="prose prose-sm max-w-none"><p><em>Authors: ${data.details.authors.join(', ')}</em> (${data.details.year})</p><hr><p><strong>Abstract (キーワード強調):</strong></p><div class="p-2 border bg-slate-50 rounded text-xs" style="max-height: 200px; overflow-y: auto;">${highlightedAbstract || 'アブストラクト情報がありません。'}</div></div>`;
                bodyHtml = `<div class="component-body p-2">${paperBody}</div><div class="component-memo p-2 border-t border-slate-200 bg-slate-50 rounded-b-md"><textarea class="prose-textarea auto-resize-textarea" placeholder="ここにメモを入力..."></textarea></div>`;
                break;
            default:
                headerHtml = `<h3 class="font-semibold text-sm">${data.name || '不明なブロック'}</h3>`;
                bodyHtml = `<div class="component-body p-2"><p>詳細情報なし</p></div>`;
        }

        component.innerHTML = `<div class="component-content"><div class="component-header">${headerHtml}${controlsHtml}</div>${bodyHtml}</div>`;

        if (data.type === 'topic') {
            const chartContainer = component.querySelector('.year-chart-container');
            if (chartContainer) createYearDistChart(chartContainer, data.details.yearDistribution);
        }
        if (data.type === 'folder') {
            const childContainer = component.querySelector('.component-children-container');
            if (childContainer) initSortable(childContainer);
        }
        const textarea = component.querySelector('.auto-resize-textarea');
        if (textarea) {
            textarea.addEventListener('input', autoResizeTextarea);
            autoResizeTextarea.call(textarea);
        }
        return component;
    }

    function addBlock(data, targetContainer = canvas) {
        const placeholder = canvas.querySelector('.placeholder-text');
        if (placeholder) placeholder.remove();
        const blockElement = createBlockElement(data);
        targetContainer.appendChild(blockElement);
    }

    function addTemplateFolders(templateType) {
        const folderNames = TEMPLATES[templateType];
        if (!folderNames) return;
        folderNames.forEach(name => {
            addBlock({ type: 'folder', name: name });
        });
    }

    // --- SortableJS Initialization ---
    function initSortable(element) {
        new Sortable(element, { group: 'nested', animation: 150, handle: '.drag-handle', fallbackOnBody: true, swapThreshold: 0.65 });
    }

    if (canvas) {
        initSortable(canvas);
        canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; canvas.classList.add('bg-indigo-50', 'border-indigo-400', 'border-dashed', 'border-2'); });
        canvas.addEventListener('dragleave', (e) => { if (!canvas.contains(e.relatedTarget)) { canvas.classList.remove('bg-indigo-50', 'border-indigo-400', 'border-dashed', 'border-2'); } });
        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            canvas.classList.remove('bg-indigo-50', 'border-indigo-400', 'border-dashed', 'border-2');
            const jsonData = e.dataTransfer.getData('application/json');
            if (jsonData) {
                try {
                    const data = JSON.parse(jsonData);
                    if (data && data.type && data.name) {
                        let dropTarget = e.target;
                        while(dropTarget && !dropTarget.classList.contains('component-children-container') && dropTarget !== canvas) { dropTarget = dropTarget.parentElement; }
                        if (!dropTarget || (!dropTarget.classList.contains('component-children-container') && dropTarget !== canvas)) { dropTarget = canvas; }
                        addBlock(data, dropTarget);
                    }
                } catch (error) { console.error('Failed to parse dropped data:', error); }
            }
        });

        canvas.addEventListener('click', (e) => {
            const component = e.target.closest('.component');
            if (!component) return;
            
            // --- Component Controls ---
            if (e.target.closest('.delete-btn')) {
                component.remove();
                if (canvas.querySelectorAll('.component').length === 0) {
                     canvas.innerHTML = `<div class="text-center text-slate-400 placeholder-text"><p class="text-lg font-semibold">ここにブロックを追加</p><p>左の分析結果から知見をドラッグ＆ドロップできます</p></div>`;
                }
            }
            if (e.target.closest('.toggle-collapse-btn')) {
                const button = e.target.closest('.toggle-collapse-btn');
                const body = component.querySelector('.component-body, .component-children-container');
                const memo = component.querySelector('.component-memo');
                if (body) {
                    const isCollapsed = body.style.display === 'none';
                    body.style.display = isCollapsed ? '' : 'none';
                    if (memo) memo.style.display = isCollapsed ? '' : 'none';
                    button.innerHTML = isCollapsed ? '－' : '＋';
                }
            }

            // --- Paper Title Click ---
            const paperTitle = e.target.closest('[data-paper-id]');
            if (paperTitle) {
                const paperId = paperTitle.dataset.paperId;
                const event = new CustomEvent('selectPaperFromEditor', {
                    detail: { paperId: paperId },
                    bubbles: true
                });
                canvas.dispatchEvent(event);
            }
        });
    }

    // --- Control Buttons ---
    if (addParagraphBtn) {
        addParagraphBtn.addEventListener('click', () => {
            addBlock({ type: 'paragraph', name: '新しいパラグラフ' });
        });
    }

    // --- Dropdown Logic ---
    if (templateDropdownContainer) {
        addFolderDropdownBtn.addEventListener('click', () => {
            templateDropdownMenu.classList.toggle('hidden');
        });

        templateDropdownMenu.addEventListener('click', (e) => {
            e.preventDefault();
            const target = e.target.closest('a[data-template-type]');
            if (target) {
                addTemplateFolders(target.dataset.templateType);
                templateDropdownMenu.classList.add('hidden');
            }
        });

        if (addSingleFolderBtn) {
            addSingleFolderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                addBlock({ type: 'folder', name: '新しいフォルダー' });
                templateDropdownMenu.classList.add('hidden');
            });
        }

        window.addEventListener('click', (e) => {
            if (!templateDropdownContainer.contains(e.target)) {
                templateDropdownMenu.classList.add('hidden');
            }
        });
    }

    // --- Panel Collapse Logic ---
    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            const isCollapsed = panelRight.classList.toggle('collapsed');
            panelLeft.classList.toggle('expanded');
            
            collapseIconOpen.classList.toggle('hidden', isCollapsed);
            collapseIconClosed.classList.toggle('hidden', !isCollapsed);

            // Rerender active visualization to adapt to new size
            window.dispatchEvent(new Event('resize'));
        });
    }
});
