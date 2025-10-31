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

    // --- Synthesis Elements (Moved from visualization.js) ---
    const generateSynthesisBtn = document.getElementById('generate-synthesis-btn');
    const synthesisOutput = document.getElementById('synthesis-output');

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

    function createYearDistChart(container, yearData, initialSelectedYear) {
        if (!yearData || yearData.length === 0) {
            container.innerHTML = "<p>年代分布データがありません。</p>";
            return;
        };
        const margin = {top: 10, right: 10, bottom: 35, left: 30};
        const containerWidth = container.getBoundingClientRect().width || 300;
        const width = containerWidth - margin.left - margin.right;
        const height = 120 - margin.top - margin.bottom;
        
        // コンテナをクリア
        d3.select(container).html('');
        
        const svg = d3.select(container).append("svg")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);
            
        const x = d3.scaleBand().domain(yearData.map(d => d[0])).range([0, width]).padding(0.2);
        const y = d3.scaleLinear().domain([0, d3.max(yearData, d => d[1])]).range([height, 0]);
        
        svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).tickValues(x.domain().filter((d,i) => !(i%5) || i === x.domain().length - 1))).selectAll("text").style("text-anchor", "end").attr("dx", "-.8em").attr("dy", ".15em").attr("transform", "rotate(-65)");
        svg.append("g").call(d3.axisLeft(y).ticks(Math.min(5, d3.max(yearData, d => d[1]))));
        
        svg.selectAll(".bar")
            .data(yearData)
            .enter()
            .append("rect")
            .attr("class", "bar")
            .attr("x", d => x(d[0]))
            .attr("y", d => y(d[1]))
            .attr("width", x.bandwidth())
            .attr("height", d => height - y(d[1]))
            .attr("fill", d => d[0] == initialSelectedYear ? '#3730a3' : '#6366f1') // 選択色を濃く
            .style("cursor", "pointer")
            .on("click", (e, d) => {
                const clickedYear = d[0];
                const currentSelectedYear = container.dataset.selectedYear;
                // トグル動作: 同じ年をクリックしたら選択解除 (null)、違う年なら選択
                const newSelectedYear = (currentSelectedYear == clickedYear) ? null : clickedYear;
                
                // dataset に保存
                container.dataset.selectedYear = newSelectedYear;
                
                // バーの色を即時更新
                svg.selectAll("rect.bar")
                    .attr("fill", b => b[0] == newSelectedYear ? '#3730a3' : '#6366f1');
            })
            .append("title").text(d => `${d[0]}年: ${d[1]}件`);
            
        // 初期値を dataset にもセット
        container.dataset.selectedYear = initialSelectedYear || '';
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
        
        // ------------------ 修正点: ノードデータをJSONとして保存 ------------------
        const detailsToSave = data.details || {};
        // [修正点 3] author ノードの場合、data.stats も detailsToSave にマージする
        if (data.type === 'author' && data.stats) {
            Object.assign(detailsToSave, data.stats);
        }
        component.dataset.detailsJson = JSON.stringify(detailsToSave);
        component.dataset.blockType = data.type; // タイプを常に保存

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
                // ------------------ 修正点: パラグラフの本文(メモ欄兼用) ------------------
                bodyHtml = `<div class="component-body p-2">
                                <textarea class="prose-textarea auto-resize-textarea data-memo-input" placeholder="ここに本文を入力...">${data.content || ''}</textarea>
                            </div>
                            <div class="component-children-container min-h-[40px] bg-slate-50 p-2 rounded-b-md border-t"></div>`;
                break;
            case 'folder':
                headerHtml = `<input type="text" class="font-semibold text-sm bg-transparent focus:bg-white focus:ring-1 focus:ring-indigo-500 rounded p-1 w-full" value="${data.name || '新しいフォルダー'}">`;
                // ------------------ 修正点: フォルダーのメモ欄 ------------------
                bodyHtml = `<div class="component-memo p-2 border-t border-slate-200 bg-slate-100"><textarea class="prose-textarea auto-resize-textarea data-memo-input" placeholder="このフォルダーに関するメモ..."></textarea></div>
                            <div class="component-children-container min-h-[40px] bg-slate-50 p-2 rounded-b-md border-t"></div>`;
                break;
            case 'author':
                headerHtml = `<h3 class="font-semibold text-sm truncate pr-2" title="${data.name}">${data.name}</h3>`;
                // [修正点 3] data.stats は data.details にマージされた
                const authorStats = data.details || {};
                const authorBody = `<div class="prose prose-sm max-w-none"><p><strong>共著論文数:</strong> ${authorStats.coauthorCount || 0}件</p><p><strong>最も多い共著トピック:</strong> ${authorStats.mostFrequentTopic || 'N/A'}</p></div>`;
                // ------------------ 修正点: メモ欄に data-memo-input クラス付与 ------------------
                bodyHtml = `<div class="component-body p-2">${authorBody}</div><div class="component-memo p-2 border-t border-slate-200 bg-slate-50 rounded-b-md"><textarea class="prose-textarea auto-resize-textarea data-memo-input" placeholder="ここにメモを入力..."></textarea></div>`;
                break;
            case 'topic':
                headerHtml = `<h3 class="font-semibold text-sm truncate pr-2" title="${data.name}">${data.name}</h3>`;
                
                // ------------------ 修正点: 焦点キーワードUIの変更 (select -> span) ------------------
                const keywordList = data.details.keywords ? data.details.keywords.split(', ') : [];
                // 以前の選択状態を復元 (selectedKeywords は複数形の配列)
                const selectedKeywords = new Set(data.details.selectedKeywords || []);

                const keywordsHtml = keywordList.length > 0
                    ? keywordList.map(k => 
                        `<span class="focus-keyword-btn inline-block cursor-pointer rounded-full px-3 py-1 text-xs font-medium mr-2 mb-2 border
                        ${selectedKeywords.has(k) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}"
                        data-keyword="${k}">
                            ${k}
                        </span>`
                    ).join('')
                    : '<p class="text-xs text-slate-500">キーワードがありません。</p>';

                const topPapersHtml = data.details.topCitedPapers.length > 0 ? data.details.topCitedPapers.map(p => `<li>${p.title} (${p.year}) - <strong>${p.cit_cnt} citations</strong></li>`).join('') : '<li>該当する論文はありません。</li>';
                const topicBody = `<div class="prose prose-sm max-w-none">
                    <p><strong>トピックキーワード (焦点キーワード選択):</strong></p>
                    <div class="focus-keyword-container flex flex-wrap mb-2">
                        ${keywordsHtml}
                    </div>
                    <hr>
                    <p><strong>引用数トップ3論文:</strong></p><ol>${topPapersHtml}</ol><hr>
                    <p><strong>論文の年代分布 (クリックで年を選択):</strong></p><div class="year-chart-container" style="width: 100%;"></div>
                </div>`;
                // ------------------ 修正点: メモ欄に data-memo-input クラス付与 ------------------
                bodyHtml = `<div class="component-body p-2">${topicBody}</div><div class="component-memo p-2 border-t border-slate-200 bg-slate-50 rounded-b-md"><textarea class="prose-textarea auto-resize-textarea data-memo-input" placeholder="ここにメモを入力..."></textarea></div>`;
                break;
            case 'paper':
                headerHtml = `<h3 class="font-semibold text-sm truncate pr-2 hover:text-indigo-600 hover:underline cursor-pointer" title="${data.details.title}" data-paper-id="${data.details.paper_id}">${data.details.title}</h3>`;
                const highlightedAbstract = highlightKeywords(data.details.abstract, data.details.keywords);
                const paperBody = `<div class="prose prose-sm max-w-none"><p><em>Authors: ${data.details.authors.join(', ')}</em> (${data.details.year})</p><hr><p><strong>Abstract (キーワード強調):</strong></p><div class="p-2 border bg-slate-50 rounded text-xs" style="max-height: 200px; overflow-y: auto;">${highlightedAbstract || 'アブストラクト情報がありません。'}</div></div>`;
                // ------------------ 修正点: メモ欄に data-memo-input クラス付与 ------------------
                bodyHtml = `<div class="component-body p-2">${paperBody}</div><div class="component-memo p-2 border-t border-slate-200 bg-slate-50 rounded-b-md"><textarea class="prose-textarea auto-resize-textarea data-memo-input" placeholder="ここにメモを入力..."></textarea></div>`;
                break;
            default:
                headerHtml = `<h3 class="font-semibold text-sm">${data.name || '不明なブロック'}</h3>`;
                bodyHtml = `<div class="component-body p-2"><p>詳細情報なし</p></div>`;
        }

        component.innerHTML = `<div class="component-content"><div class="component-header">${headerHtml}${controlsHtml}</div>${bodyHtml}</div>`;

        if (data.type === 'topic') {
            const chartContainer = component.querySelector('.year-chart-container');
            // ★ 修正: selectedYear を取得して createYearDistChart に渡す
            const selectedYear = data.details.selectedYear || null;
            if (chartContainer) createYearDistChart(chartContainer, data.details.yearDistribution, selectedYear);
            
            // ------------------ 修正点: キーワード選択(span)のイベントリスナー ------------------
            const keywordContainer = component.querySelector('.focus-keyword-container');
            if (keywordContainer) {
                keywordContainer.addEventListener('click', (e) => {
                    const target = e.target.closest('.focus-keyword-btn');
                    if (!target) return;
                    
                    // クラスをトグルして選択/非選択を切り替え
                    target.classList.toggle('bg-indigo-600');
                    target.classList.toggle('text-white');
                    target.classList.toggle('border-indigo-600');
                    target.classList.toggle('bg-white');
                    target.classList.toggle('text-slate-700');
                    target.classList.toggle('border-slate-300');
                });
            }
        }
        // ------------------ 修正点: 'paragraph' と 'folder' も子コンテナを持つ ------------------
        if (data.type === 'paragraph' || data.type === 'folder') {
            const childContainer = component.querySelector('.component-children-container');
            if (childContainer) initSortable(childContainer);
        }
        const textarea = component.querySelector('.auto-resize-textarea');
        if (textarea) {
            textarea.addEventListener('input', autoResizeTextarea);
            setTimeout(() => autoResizeTextarea.call(textarea), 0);
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
            // ------------------ 修正点: テンプレートはフォルダーとして追加 ------------------
            addBlock({ type: 'folder', name: name });
        });
    }

    // --- SortableJS Initialization ---
    function initSortable(element) {
        new Sortable(element, { group: 'nested', animation: 150, handle: '.drag-handle', fallbackOnBody: true, swapThreshold: 0.65 });
    }
    
    function parseComponent(element) {
        const data = {};
        const header = element.querySelector('.component-header');
        if (!header) return null;
        
        data.type = element.dataset.blockType || 'paragraph';
        try {
            data.details = JSON.parse(element.dataset.detailsJson || '{}');
        } catch (e) {
            console.error("Failed to parse details JSON:", e);
            data.details = {};
        }

        const titleInput = header.querySelector('input[type="text"]');
        const titleH3 = header.querySelector('h3');
        data.name = titleInput ? titleInput.value : (titleH3 ? titleH3.textContent.trim() : '無題');
    
        const childContainer = element.querySelector('.component-children-container');
        // ------------------ 修正点: メモ欄/本文欄の取得 ------------------
        const memoOrContentTextarea = element.querySelector('.data-memo-input');
        
        if (memoOrContentTextarea) {
            // 'paragraph' の場合は content、それ以外は memo として保存
            if (data.type === 'paragraph') {
                data.content = memoOrContentTextarea.value;
            } else {
                data.memo = memoOrContentTextarea.value;
            }
        }
    
        if (data.type === 'folder' || data.type === 'paragraph') {
            // ------------------ 修正点: パラグラフも子を持つように変更 ------------------
            data.children = Array.from(childContainer.querySelectorAll(':scope > .component')).map(parseComponent).filter(Boolean);
        } else if (data.type === 'paper') {
            // (paper ノードは変更なし)
        } else if (data.type === 'author') {
            // [修正点 3] author ノードのパース (stats は details にマージされている)
            data.name = titleH3 ? titleH3.textContent.trim() : '不明な著者';
            // data.stats は不要 (data.details に含まれる)
        } else if (data.type === 'topic') {
            // ------------------ 修正点: 選択されたキーワード(複数)をパース ------------------
            const selectedKeywordNodes = element.querySelectorAll('.focus-keyword-btn.bg-indigo-600');
            data.details.selectedKeywords = Array.from(selectedKeywordNodes).map(node => node.dataset.keyword);
            // 古い selectedKeyword を削除
            delete data.details.selectedKeyword;
            
            // ★ 修正: 選択された年をパース
            const chartContainer = element.querySelector('.year-chart-container');
            if (chartContainer && chartContainer.dataset.selectedYear && chartContainer.dataset.selectedYear !== 'null' && chartContainer.dataset.selectedYear !== '') {
                data.details.selectedYear = chartContainer.dataset.selectedYear;
            } else {
                delete data.details.selectedYear; // null または空文字列の場合はキーを削除
            }
            
        } else {
            // 未知のノードタイプは無視
            return null;
        }
        return data;
    }
    
    window.getCanvasStructure = function() {
        const canvas = document.getElementById('canvas');
        const topLevelNodes = canvas.querySelectorAll(':scope > .component');
        return Array.from(topLevelNodes).map(parseComponent).filter(Boolean);
    };

    if (canvas) {
        initSortable(canvas);
        canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; canvas.classList.add('bg-indigo-50', 'border-indigo-400', 'border-dashed', 'border-2'); });
        canvas.addEventListener('dragleave', (e) => { if (!canvas.contains(e.relatedTarget)) { canvas.classList.remove('bg-indigo-50', 'border-indigo-400', 'border-dashed', 'border-2'); } });
        
        // ------------------ 修正点: ドロップ制約ロジック ------------------
        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            canvas.classList.remove('bg-indigo-50', 'border-indigo-400', 'border-dashed', 'border-2');
            const jsonData = e.dataTransfer.getData('application/json');
            if (jsonData) {
                try {
                    const data = JSON.parse(jsonData);
                    if (!data || !data.type || !data.name) return;

                    let dropTarget = e.target;
                    while(dropTarget && !dropTarget.classList.contains('component-children-container') && dropTarget !== canvas) {
                        dropTarget = dropTarget.parentElement;
                    }
                    if (!dropTarget || (!dropTarget.classList.contains('component-children-container') && dropTarget !== canvas)) {
                        dropTarget = canvas;
                    }

                    // --- 制約ロジック ---
                    // 1. 最上位 (canvas) へのドロップ
                    if (dropTarget === canvas) {
                        if (data.type !== 'paragraph' && data.type !== 'folder') {
                            console.warn('最上位にはパラグラフまたはフォルダーのみ追加できます。');
                            return; // 論文・トピック・著者は最上位NG
                        }
                    }
                    // 2. 内部 (children-container) へのドロップ
                    else if (dropTarget.classList.contains('component-children-container')) {
                         if (data.type === 'paragraph' || data.type === 'folder') {
                             console.warn('パラグラフまたはフォルダーの内部には追加できません。');
                             return; // パラグラフ・フォルダーは内部NG
                         }
                    }
                    
                    addBlock(data, dropTarget);
                    
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
                // ------------------ 修正点: パラグラフ/フォルダーのトグル対象 ------------------
                const body = component.querySelector('.component-body, .component-memo'); // 本文またはメモ欄
                const children = component.querySelector('.component-children-container'); // 子コンテナ
                
                const isCollapsed = (body && body.style.display === 'none') || (children && children.style.display === 'none');
                
                if (body) body.style.display = isCollapsed ? '' : 'none';
                if (children) children.style.display = isCollapsed ? '' : 'none';
                
                button.innerHTML = isCollapsed ? '－' : '＋';
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

    // ------------------ 修正点: 新しい文章生成ロジック ------------------
    if (generateSynthesisBtn) {

        /**
         * paragraphNode（の子）を再帰的に走査し、要求されたデータを収集する
         */
        function collectData(nodes) {
            // [修正点] 収集するデータを拡充
            let collected = { papers: [], topics: [], authors: [], memos: [], relationships: [] };
            if (!nodes) return collected;

            const paperIdsInNode = new Set();

            nodes.forEach(node => {
                if (node.type === 'paper') {
                    // [修正点 1] pdf_url を収集
                    collected.papers.push({
                        id: node.details.paper_id,
                        title: node.details.title,
                        abstract: node.details.abstract,
                        year: node.details.year,
                        authors: node.details.authors,
                        pdf_url: node.details.pdf_url || "" // pdf_url を追加
                    });
                    paperIdsInNode.add(node.details.paper_id);
                } else if (node.type === 'topic') {
                    // [修正点 2] トピックに属する全論文情報 (allPapersInTopic) を収集
                    // ★ 修正: selectedYear を収集
                    collected.topics.push({
                        topCited: node.details.topCitedPapers,
                        yearDist: node.details.yearDistribution,
                        focusKeywords: node.details.selectedKeywords || [],
                        allPapersInTopic: node.details.allPapersInTopic || [], // allPapersInTopic を追加
                        selectedYear: node.details.selectedYear || null // ★ 選択された年を追加
                    });
                } else if (node.type === 'author') {
                    // [修正点 3] 著者に属する全共著論文情報 (coauthoredPapers) を収集
                    collected.authors.push({
                        name: node.name,
                        coauthorCount: node.details.coauthorCount, // detailsから取得
                        mostFrequentTopic: node.details.mostFrequentTopic, // detailsから取得
                        coauthoredPapers: node.details.coauthoredPapers || [] // coauthoredPapers を追加
                    });
                }
                
                if (node.memo) {
                    collected.memos.push(node.memo);
                }
            });

            const allEdges = window.currentVisualizationData ? window.currentVisualizationData.edges : [];
            if (allEdges.length > 0) {
                collected.relationships = allEdges.filter(edge => 
                    paperIdsInNode.has(edge.source) && paperIdsInNode.has(edge.target)
                );
            }

            return collected;
        }

        /**
         * パラグラフノード (folder または paragraph) 1つ分のプロンプトを生成する
         */
        function createParagraphPrompt(paragraphNode) {
            const internalData = collectData(paragraphNode.children || []);
            const mainAuthorName = window.currentVisualizationData ? window.currentVisualizationData.main_author_name : "当該研究者";
            
            // [修正点] contextInfo のセクション名をより具体的にする
            let contextInfo = '';
            if (paragraphNode.type === 'paragraph' && paragraphNode.content) {
                contextInfo += `### パラグラフの既存本文（下書き） ###\n"${paragraphNode.content}"\n`;
            }
            if (paragraphNode.type === 'folder' && paragraphNode.memo) {
                 contextInfo += `### フォルダー全体のメモ ###\n"${paragraphNode.memo}"\n`;
            }

            // [修正点] プロンプトを更新し、新しいデータをJSON文字列として含める
            // (注: 論文リストは簡略化しないとトークン数を圧迫するが、ユーザーの要望通り全データ（の要約）を渡す)
            const prompt = `
### ペルソナ設定 ###
あなたは、経験豊富な学術編集者です。
あなたの任務は、与えられた「タイトル」、「メイン著者」、および「構成要素」に基づき、一つの流暢で論理的なパラグラフ（本文）を作成することです。

### 最重要タスク（厳守） ###
提供される「パラグラフの既存本文（下書き）」または「フォルダー全体のメモ」は、ユーザーによる最も重要な指示です。
あなたは、これらの指示を「構成要素」のデータよりも優先し、**必ず**反映させなければなりません。
* 「既存本文（下書き）」がある場合：あなたのタスクは、この下書きを**リライト**し、構成要素の情報を追加して洗練させることです。下書きの意図を**絶対に**無視しないでください。
* 「フォルダー全体のメモ」がある場合：あなたのタスクは、そのメモの指示（例：「○○を強調する」）を**実行**することです。
* 「各構成要素の個別メモ」がある場合：そのメモは、特定の論文やトピックに言及する際の**必須**の指示です。

### メイン著者 ###
${mainAuthorName}

### タイトル ###
"${paragraphNode.name}"

${contextInfo}
### 構成要素（このパラグラフに含めるべき情報） ###
---
[論文ノード] (ID, タイトル, 年, 要旨, PDFリンク): 
${JSON.stringify(internalData.papers.map(p => ({
    id: p.id, 
    title: p.title, 
    year: p.year, 
    abstract: p.abstract,
    pdf_url: p.pdf_url
})))}
---
[トピックノード] (焦点キーワード, 選択年, トピック内の全論文リスト(要旨,引用数,年)):
${JSON.stringify(internalData.topics.map(t => ({ 
    focusKeywords: t.focusKeywords,
    selectedYear: t.selectedYear,
    allPapersInTopic: t.allPapersInTopic.map(p => ({ // [修正点 2] トピック内の全論文
        title: p.title,
        abstract: p.abstract,
        cit_cnt: p.cit_cnt,
        year: p.year
    }))
})))}
---
[著者ノード] (名前, 共著数, 主要トピック, 全共著論文リスト(要旨,年)):
${JSON.stringify(internalData.authors.map(a => ({
    name: a.name,
    coauthorCount: a.coauthorCount,
    mostFrequentTopic: a.mostFrequentTopic,
    coauthoredPapers: a.coauthoredPapers.map(p => ({ // [修正点 3] 全共著論文
        title: p.title,
        abstract: p.abstract,
        year: p.year
    }))
})))}
---
[論文間の関係性] (引用): 
${JSON.stringify(internalData.relationships)}
---
[各構成要素の個別メモ]: 
${JSON.stringify(internalData.memos)}
---

### 補助的な指示 ###
1.  **論理構成:** まず、このパラグラフに含まれる論文全体の「研究背景」や「問題点」を（各論文の要旨やトピック情報から抽出し）冒頭にまとめて提示してください。その後、時系列や論理の流れ（例えば、アプローチ、結果、考察）に沿って、各論文の貢献を説明してください。単なる情報の羅列を避け、自然な流れになるように接続詞（「しかし」「そのため」「さらに」など）を適切に使用してください。
2.  **時系列の考慮:** 論文やトピックは、可能な限り時系列（\`year\` 情報）に沿って言及し、研究の変遷がわかるように記述してください。
3.  **著者中心:** ${mainAuthorName} が（または ${mainAuthorName} を中心とするチームが）何を行ったのか、という視点を明確にしてください。
4.  **著者情報の反映:** 「構成要素」に『著者ノード』が含まれている場合、その著者（${mainAuthorName} の共著者）がどのような共同研究（名前、共著論文数、主要トピック、共著論文リスト）を行ったかについて、本文中に具体的に組み込んでください。（例：～は、${mainAuthorName} の主要な共同研究者の一人であり、特に[トピック名]の分野で[XX]件の論文を共著している。）
5.  **関係性の反映:** 「論文間の関係性（引用）」情報を利用し、ある論文が別の論文に基づいている（引用している）場合、その関係性（例：「この研究は、以前の [論文A] の結果を発展させたものである...」）を記述に含めてください。
6.  **参照形式（厳守）:** 「構成要素」に含まれる論文に言及する際は、必ず \`[論文: "論文のタイトル" (ID: paper_id)]\` という形式を使用してください。**構成要素に含まれていない論文を新たに追加で引用しないでください。** ハルシネーションは厳禁です。
7.  **トーン:** 学術的、客観的、かつ明快。
8.  **出力:** 指示された内容の文章（パラグラフ）のみとし、余計な前置きや見出しは含めないでください。
9.  **★ 年代の注目:** 「構成要素」の[トピックノード]に \`selectedYear\` (例: \`2020\`) が指定されている場合、その年に発表された論文（\`allPapersInTopic\` リスト内の該当する論文）に特に注目し、その年の研究がどのような意味を持つのかを重点的に記述してください。（例：「特に2020年には、[論文X]や[論文Y]が発表され、この分野の転換点となった...」）
`;
            return prompt;
        }
        
        /**
         * HTMLを構築する（結果配列を処理する）
         */
        function buildHtml(results) { // results は [{node, text}, ...]
            let html = '';
            results.forEach(result => {
                const { node, text } = result;

                // フォルダまたはパラグラフのタイトル
                html += `<h2 class="text-lg font-semibold mt-4 mb-2 border-b pb-1">${node.name}</h2>`;

                // AIが生成したMarkdown風の見出しをHTMLに変換
                let formattedText = text
                    .replace(/^### (.*$)/gim, '<h4 class="font-semibold text-sm mt-2 mb-1">$1</h4>')
                    .replace(/^## (.*$)/gim, '<h3 class="font-semibold text-base mt-3 mb-1">$1</h3>')
                    .replace(/^# (.*$)/gim, '<h2 class="font-semibold text-lg mt-4 mb-2">$1</h2>')
                    .replace(/^\* (.*$)/gim, '<ul><li>$1</li></ul>') // 簡易リスト変換
                    .replace(/\n/g, '<br />'); // 改行を<br>に

                // ★ 修正点: [論文: "Title" (ID: pid)] または [論文: "Title" (2007)] 等を置換
                formattedText = formattedText.replace(
                    /\[論文: "([^"]+)"(?:\s\(([^)]+)\))?\]/g, // グループ1: タイトル, グループ2: ( )の中身全体 (オプション)
                    (match, title, parenthesesContent) => {
                        
                        let paperId = null;
                        const allNodes = window.currentVisualizationData ? window.currentVisualizationData.nodes : [];
                        let paperNode = null;

                        if (parenthesesContent) {
                            // ( ) の中身 (parenthesesContent) から "ID: W..." を探す
                            const idMatch = parenthesesContent.match(/ID:\s*([Ww]\d+)/);
                            if (idMatch && idMatch[1]) {
                                paperId = idMatch[1].trim();
                            }
                        }

                        if (paperId) {
                            // 1. IDが (ID: ...) 形式で指定された場合
                            paperNode = allNodes.find(p => p.paper_id === paperId);
                        } else {
                            // 2. IDが指定されなかった場合、タイトルで検索
                            paperNode = allNodes.find(p => p.title.toLowerCase() === title.toLowerCase());
                            if (paperNode) {
                                paperId = paperNode.paper_id; // タイトル検索で ID を発見
                            }
                        }


                        if (paperId && paperNode) {
                            // IDとノードが見つかった場合
                            const pdfUrl = paperNode.pdf_url;
                            const openAlexUrl = `https://openalex.org/${paperId}`; 

                            if (pdfUrl) {
                                // 1. PDF URL (OAリンク) がある場合
                                return `<a href="${pdfUrl}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:underline" title="PDFを開く">${title}</a>
                                        <span class="paper-link text-xs text-slate-500 hover:underline cursor-pointer ml-1" data-paper-id="${paperId}" title="クリックして左の分析ビューで選択">[分析ビュー]</span>`;
                            } else {
                                // 2. PDF URL はないが ID はある場合 (OpenAlexリンクを使用)
                                return `<a href="${openAlexUrl}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:underline" title="OpenAlexで開く">${title}</a>
                                        <span class="paper-link text-xs text-slate-500 hover:underline cursor-pointer ml-1" data-paper-id="${paperId}" title="クリックして左の分析ビューで選択">[分析ビュー]</span>`;
                            }
                        } else {
                            // IDが見つからなかった場合 (例: IDなし、またはタイトルがデータに一致しない)
                            // タイトルのみをテキストとして表示
                            return title;
                        }
                    }
                );

                // <ul>が連続するのをまとめる（簡易的）
                formattedText = formattedText.replace(/<\/ul><br \/><ul>/g, '');

                html += `<div class="generated-section mb-3 pl-3 border-l-4 border-indigo-100">`;
                
                // (paragraphタイプの場合、タイトルはh2で表示済み)
                
                html += `<div class="prose prose-sm max-w-none text-slate-800">${formattedText}</div>`;
                html += `</div>`;
                
                // (子ノードのHTML構築は不要。既に親が全情報を使って生成しているため)
            });
            return html;
        }

        /**
         * メインの生成処理
         */
        async function handleSynthesisGeneration() {
            if (!window.getCanvasStructure) {
                synthesisOutput.innerHTML = '<p class="text-red-500">エラー: 構成解析機能が見つかりません。</p>';
                return;
            }
            // 修正点: グローバルデータが存在するか確認
            if (!window.currentVisualizationData) {
                synthesisOutput.innerHTML = '<p class="text-red-500">エラー: 分析データが読み込まれていません。左のパネルで分析を実行してください。</p>';
                return;
            }

            const structure = window.getCanvasStructure();
            if (structure.length === 0) {
                synthesisOutput.innerHTML = '<p class="text-slate-500">文章を生成するには、まず右のツールにブロックを配置してください。</p>';
                return;
            }

            synthesisOutput.innerHTML = '<p class="text-slate-500">各パラグラフの文章を並列で生成し、統合しています...</p>';
            
            try {
                // 1. 各パラグラフ (structure の各要素) ごとにプロンプトを生成し、API呼び出しタスクを作成
                const generationTasks = structure
                    .filter(node => node.type === 'paragraph' || node.type === 'folder')
                    .map(paragraphNode => {
                        const prompt = createParagraphPrompt(paragraphNode);
                        
                        // window.callGeminiAPI は visualization.js で定義されている
                        return window.callGeminiAPI(prompt).then(text => {
                            return { node: paragraphNode, text }; // ノード情報とテキストをペアで返す
                        });
                    });
                
                // 2. 全てのタスクを並列実行
                const results = await Promise.all(generationTasks); // [{node, text}, {node, text}, ...]

                // 4. HTMLを構築
                const finalHtml = buildHtml(results);
                synthesisOutput.innerHTML = finalHtml;

                // 修正点: 生成されたHTML内のリンクにイベントリスナーを追加
                synthesisOutput.querySelectorAll('.paper-link').forEach(link => {
                    link.addEventListener('click', (e) => {
                        const paperId = e.target.dataset.paperId;
                        if (paperId) {
                            const event = new CustomEvent('selectPaperFromEditor', {
                                detail: { paperId: paperId },
                                bubbles: true
                            });
                            // canvas 要素からディスパッチ（visualization.js が document をリッスンしているため）
                            canvas.dispatchEvent(event);
                        }
                    });
                });

            } catch(error) {
                console.error("Error during synthesis generation:", error);
                synthesisOutput.innerHTML = `<p class="text-red-500">文章生成中にエラーが発生しました: ${error.message}</p>`;
            }
        }
        
        generateSynthesisBtn.addEventListener('click', handleSynthesisGeneration);
    }

    // ------------------ 修正点: 初期状態でパラグラフを1つ追加 ------------------
    addBlock({ type: 'paragraph', name: '新しいパラグラフ' });

});

