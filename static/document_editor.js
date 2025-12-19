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

    // --- Synthesis Elements ---
    const generateSynthesisBtn = document.getElementById('generate-synthesis-btn');
    const synthesisOutput = document.getElementById('synthesis-output');

    // --- Template Definitions ---
    const TEMPLATES = {
        A: ['導入（受賞理由と生い立ち）', '経歴（キャリア形成の道のり）', '主要な業績', '影響と後世への功績', '総括（人物像と遺産）'],
        B: ['導入', '業績1', '業績2', '総括'],
        C: ['導入', '背景と着想', '理論の構築と展開', '応用と影響', '総括']
    };

    // --- Utility Functions ---

    function autoResizeTextarea() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    }

    function createYearDistChart(container, yearData) {
        if (!yearData || yearData.length === 0) {
            container.innerHTML = "<p class='text-xs text-slate-500 p-2'>年代分布データがありません。</p>";
            return;
        };

        const margin = { top: 10, right: 10, bottom: 20, left: 30 };
        const containerRect = container.getBoundingClientRect();
        // コンテナの高さを使用 (デフォルト100px)
        const effectiveHeight = containerRect.height > 0 ? containerRect.height : 100;
        const width = (containerRect.width || 300) - margin.left - margin.right;
        const height = effectiveHeight - margin.top - margin.bottom;

        if (width <= 0 || height <= 0) return; // コンテナが非表示の場合は描画しない

        container.innerHTML = '';
        const svg = d3.select(container).append("svg")
            .attr("width", "100%")
            .attr("height", "100%")
            .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
            .attr("preserveAspectRatio", "xMidYMid meet")
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        const x = d3.scaleBand().domain(yearData.map(d => d[0])).range([0, width]).padding(0.2);
        const y = d3.scaleLinear().domain([0, d3.max(yearData, d => d[1])]).range([height, 0]);

        svg.append("g").attr("transform", `translate(0,${height})`)
            .call(d3.axisBottom(x).tickValues(x.domain().filter((d, i) => !(i % 5) || i === x.domain().length - 1)))
            .selectAll("text")
            .style("text-anchor", "end")
            .attr("dx", "-.8em")
            .attr("dy", ".15em")
            .attr("transform", "rotate(-65)")
            .style("font-size", "10px");

        svg.append("g").call(d3.axisLeft(y).ticks(Math.min(3, d3.max(yearData, d => d[1]))))
            .style("font-size", "10px");

        svg.selectAll(".bar")
            .data(yearData)
            .enter()
            .append("rect")
            .attr("class", "bar")
            .attr("x", d => x(d[0]))
            .attr("y", d => y(d[1]))
            .attr("width", x.bandwidth())
            .attr("height", d => height - y(d[1]))
            .attr("fill", '#6366f1')
            .append("title").text(d => `${d[0]}年: ${d[1]}件`);
    }

    function highlightKeywords(abstractText, keywords) {
        if (!keywords || !abstractText) return abstractText;
        let kwList = [];
        if (typeof keywords === 'string') {
            kwList = keywords.split(',').map(s => s.trim());
        } else if (Array.isArray(keywords)) {
            kwList = keywords;
        } else {
            return abstractText;
        }
        if (kwList.length === 0) return abstractText;

        const sortedKeywords = [...new Set(kwList)].sort((a, b) => b.length - a.length);
        // \bは英単語境界。日本語などの場合はスペース区切りでないと効かない可能性があるが、英語論文前提とする。
        // ケースインセンシティブでマッチさせ、マッチした文字列そのもの($&)を使って置換する（大文字小文字維持）
        const regex = new RegExp(`\\b(${sortedKeywords.map(kw => kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})\\b`, 'gi');
        return abstractText.replace(regex, '<strong class="text-indigo-700">$&</strong>');
    }

    // --- ★ 論文ノード用のミニ引用グラフ描画関数 ---
    function renderMiniCitationGraph(container, paperId) {
        const vizData = window.currentVisualizationData;
        if (!vizData || !vizData.nodes || !vizData.edges) {
            container.innerHTML = "<p class='text-xs text-slate-500 p-2'>引用グラフデータをロード中です...</p>";
            return;
        }

        const allNodesMap = new Map(vizData.nodes.map(n => [n.paper_id, n]));
        const mainNode = allNodesMap.get(paperId);
        if (!mainNode) return;

        // 1. ノードとリンクの収集
        let graphNodes = [{ ...mainNode, id: mainNode.paper_id, type: 'main' }]; // メインノード
        let graphLinks = [];

        // 被引用（この論文が引用した論文）: 私はSource、相手はTarget
        const referencedPapers = vizData.edges
            .filter(e => e.source === paperId && allNodesMap.has(e.target))
            .map(e => allNodesMap.get(e.target));

        referencedPapers.forEach(p => {
            if (!graphNodes.find(n => n.id === p.paper_id)) {
                graphNodes.push({ ...p, id: p.paper_id, type: 'referenced' });
            }
            // 引用リンク: 私(source) -> 相手(target)
            graphLinks.push({ source: paperId, target: p.paper_id });
        });

        // 引用（この論文を引用した論文）: 相手はSource、私はTarget
        const citingPapers = vizData.edges
            .filter(e => e.target === paperId && allNodesMap.has(e.source))
            .map(e => allNodesMap.get(e.source));

        citingPapers.forEach(p => {
            if (!graphNodes.find(n => n.id === p.paper_id)) {
                graphNodes.push({ ...p, id: p.paper_id, type: 'citing' });
            }
            // 引用リンク: 相手(source) -> 私(target)
            graphLinks.push({ source: p.paper_id, target: paperId });
        });

        if (graphNodes.length <= 1) {
            container.innerHTML = "<p class='text-xs text-slate-500 text-center py-2'>ローカルな引用関係はありません。</p>";
            return;
        }

        // 2. D3.js 描画設定
        const { width, height } = container.getBoundingClientRect();
        if (width === 0 || height === 0) return; // コンテナが非表示

        const svg = d3.select(container).append("svg")
            .attr("width", width)
            .attr("height", height);

        // 3. シミュレーション設定
        const simulation = d3.forceSimulation(graphNodes)
            .force("link", d3.forceLink(graphLinks).id(d => d.id).distance(40).strength(0.5))
            .force("charge", d3.forceManyBody().strength(-100))
            .force("collision", d3.forceCollide().radius(8))
            .force("x", d3.forceX(d => {
                if (d.type === 'main') return width / 2;
                if (d.type === 'referenced') return width * 0.2; // 左側
                return width * 0.8; // 右側
            }).strength(0.5))
            .force("y", d3.forceY(height / 2).strength(0.1));

        // 4. 描画
        const link = svg.append("g")
            .selectAll("line")
            .data(graphLinks)
            .join("line")
            .attr("stroke", "#999")
            .attr("stroke-opacity", 0.6);

        const node = svg.append("g")
            .selectAll("circle")
            .data(graphNodes)
            .join("circle")
            .attr("r", d => d.type === 'main' ? 8 : 5)
            .attr("fill", d => {
                if (d.type === 'main') return "#4f46e5"; // Indigo
                if (d.type === 'referenced') return "#10b981"; // Green (被引用)
                return "#f59e0b"; // Amber (引用)
            })
            .call(d3.drag() // ドラッグ可能に
                .on("start", (event, d) => {
                    if (!event.active) simulation.alphaTarget(0.3).restart();
                    d.fx = d.x; d.fy = d.y;
                })
                .on("drag", (event, d) => {
                    d.fx = event.x; d.fy = event.y;
                })
                .on("end", (event, d) => {
                    if (!event.active) simulation.alphaTarget(0);
                    d.fx = null; d.fy = null;
                }));

        node.append("title")
            .text(d => `[${d.year}] ${d.title}`);

        simulation.on("tick", () => {
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);

            node
                .attr("cx", d => d.x = Math.max(8, Math.min(width - 8, d.x)))
                .attr("cy", d => d.y = Math.max(8, Math.min(height - 8, d.y)));
        });
    }


    // --- Core Block Creation Function ---

    function createBlockElement(data) {
        const component = document.createElement('div');
        component.className = 'component'; // Class for SortableJS to find

        const detailsToSave = data.details || {};
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
                bodyHtml = `<div class="component-body p-2">
                                <textarea class="prose-textarea auto-resize-textarea data-memo-input" placeholder="ここに本文を入力...">${data.content || ''}</textarea>
                            </div>
                            <div class="component-children-container min-h-[40px] bg-slate-50 p-2 rounded-b-md border-t"></div>`;
                break;
            case 'folder':
                headerHtml = `<input type="text" class="font-semibold text-sm bg-transparent focus:bg-white focus:ring-1 focus:ring-indigo-500 rounded p-1 w-full" value="${data.name || '新しいフォルダー'}">`;
                bodyHtml = `<div class="component-memo p-2 border-t border-slate-200 bg-slate-100"><textarea class="prose-textarea auto-resize-textarea data-memo-input" placeholder="このフォルダーに関するメモ..."></textarea></div>
                            <div class="component-children-container min-h-[40px] bg-slate-50 p-2 rounded-b-md border-t"></div>`;
                break;
            case 'author_group':
                headerHtml = `<input type="text" class="font-semibold text-sm bg-transparent focus:bg-white focus:ring-1 focus:ring-indigo-500 rounded p-1 w-full" value="${data.name || '著者グループ'}">`;
                const authorsList = (data.details.authors || [])
                    .map(author =>
                        `<li class="text-xs text-slate-700">${author.id} (${author.paper_count}件, ${author.start_year}-${author.end_year})</li>`
                    )
                    .join('');

                // ★ 年代情報の表示
                let yearInfoHtml = '';
                if (data.details.timelineData && data.details.timelineData.length > 0) {
                    const years = data.details.timelineData.map(p => p.year).filter(y => y > 0);
                    if (years.length > 0) {
                        const minYear = Math.min(...years);
                        const maxYear = Math.max(...years);
                        yearInfoHtml = `<p class="text-xs text-indigo-600 font-bold mt-1">活動期間: ${minYear}年 - ${maxYear}年 (共著 ${data.details.timelineData.length}件)</p>`;
                    } else {
                        yearInfoHtml = `<p class="text-xs text-slate-500 mt-1">活動期間不明 (共著 ${data.details.timelineData.length}件)</p>`;
                    }
                }

                // ★ 共通キーワードの抽出と表示 (Top 10)
                // ★ topCitedPaperHtmlの表示 (共通キーワードの代わり)
                let topCitedPaperHtml = '';
                if (data.details.timelineData && data.details.timelineData.length > 0) {
                    const topPaper = data.details.timelineData.reduce((prev, current) => {
                        return (prev.cit_cnt > current.cit_cnt) ? prev : current;
                    });

                    if (topPaper) {
                        topCitedPaperHtml = `<div class="mt-2 mb-2 p-2 bg-indigo-50 border border-indigo-100 rounded-md">
                            <p class="text-xs font-bold text-indigo-800 mb-1">最も引用された共著論文:</p>
                            <p class="text-xs text-slate-700 italic">"${topPaper.title}" (${topPaper.cit_cnt} Citations)</p>
                        </div>`;
                    } else {
                        topCitedPaperHtml = `<p class="text-xs text-slate-400 mt-2">共著論文なし</p>`;
                    }
                }

                const authorGroupBody = `<div class="prose prose-sm max-w-none">
                                        <p><strong>グループ構成員 (${data.details.authors ? data.details.authors.length : 0}名):</strong></p>
                                        <ul class="list-disc list-inside h-20 overflow-y-auto">${authorsList}</ul>
                                        ${yearInfoHtml}
                                        ${topCitedPaperHtml} <!-- ★ 変更 -->
                                        <p><strong>論文の年代分布 (全体像):</strong></p>
                                        <div class="year-dist-chart mt-2 bg-slate-100 rounded" style="width: 100%; height: 100px;"></div>
                                        <div class="mt-2">
                                            <label class="text-xs font-medium text-slate-700">言及する論文数:</label>
                                            <select class="data-citation-amount text-xs p-1 border-slate-300 rounded-md">
                                                <option value="normal" ${data.details.citationAmount === 'normal' ? 'selected' : ''}>普通 (4-5件)</option>
                                                <option value="low" ${data.details.citationAmount === 'low' ? 'selected' : ''}>少なめ (1-3件)</option>
                                                <option value="high" ${data.details.citationAmount === 'high' ? 'selected' : ''}>多め (6件以上)</option>
                                            </select>
                                        </div>
                                    </div>`;
                bodyHtml = `<div class="component-body p-2">${authorGroupBody}</div><div class="component-memo p-2 border-t border-slate-200 bg-slate-50 rounded-b-md"><textarea class="prose-textarea auto-resize-textarea data-memo-input" placeholder="このグループに関するメモ..."></textarea></div>`;
                break;
            case 'author':
                headerHtml = `<h3 class="font-semibold text-sm truncate pr-2" title="${data.name}">${data.name}</h3>`;
                const authorStats = data.details || {};

                const authorBody = `<div class="prose prose-sm max-w-none">
                                        <p><strong>共著論文数:</strong> ${authorStats.coauthorCount || 0}件</p>
                                        <p><strong>最多共著トピック:</strong> ${authorStats.mostFrequentTopic || 'N/A'}</p>
                                        <div class="mt-2">
                                            <label class="text-xs font-medium text-slate-700">言及する論文数:</label>
                                            <select class="data-citation-amount text-xs p-1 border-slate-300 rounded-md">
                                                <option value="normal" ${data.details.citationAmount === 'normal' ? 'selected' : ''}>普通 (4-5件)</option>
                                                <option value="low" ${data.details.citationAmount === 'low' ? 'selected' : ''}>少なめ (1-3件)</option>
                                                <option value="high" ${data.details.citationAmount === 'high' ? 'selected' : ''}>多め (6件以上)</option>
                                            </select>
                                        </div>
                                    </div>`;

                bodyHtml = `<div class="component-body p-2">${authorBody}</div><div class="component-memo p-2 border-t border-slate-200 bg-slate-50 rounded-b-md"><textarea class="prose-textarea auto-resize-textarea data-memo-input" placeholder="ここにメモを入力..."></textarea></div>`;
                break;
            case 'topic':
                headerHtml = `<h3 class="font-semibold text-sm truncate pr-2" title="${data.name}">${data.name}</h3>`;

                const keywordList = data.details.keywords ? data.details.keywords.split(', ') : [];
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

                const topicBody = `<div class="prose prose-sm max-w-none">
                    <button class="generate-summary-btn text-xs bg-indigo-500 text-white font-semibold py-1 px-2 rounded-md hover:bg-indigo-600 mb-2">このトピックの概要を生成</button>
                    <div class="topic-summary-output text-xs p-2 bg-slate-50 rounded mt-1 mb-2 hidden"></div>
                    <div class="mt-2 mb-2">
                        <label class="text-xs font-medium text-slate-700">言及する論文数:</label>
                        <select class="data-citation-amount text-xs p-1 border-slate-300 rounded-md">
                            <option value="normal" ${data.details.citationAmount === 'normal' ? 'selected' : ''}>普通 (4-5件)</option>
                            <option value="low" ${data.details.citationAmount === 'low' ? 'selected' : ''}>少なめ (1-3件)</option>
                            <option value="high" ${data.details.citationAmount === 'high' ? 'selected' : ''}>多め (6件以上)</option>
                        </select>
                    </div>
                    <hr>
                    <p><strong>トピックキーワード (焦点キーワード選択):</strong></p>
                    <div class="focus-keyword-container flex flex-wrap mb-2">
                        ${keywordsHtml}
                    </div>
                    <hr>
                    <p><strong>論文の年代分布 (全体像):</strong></p>
                    <div class="year-chart-container" style="width: 100%; height: 100px;"></div>
                    <hr>
                    <p><strong>年代範囲の絞り込み:</strong> <span class="year-range-display font-medium"></span></p>
                    <div class="year-range-slider-container compact-slider-container p-2 pt-4"></div>
                </div>`;
                bodyHtml = `<div class="component-body p-2">${topicBody}</div><div class="component-memo p-2 border-t border-slate-200 bg-slate-50 rounded-b-md"><textarea class="prose-textarea auto-resize-textarea data-memo-input" placeholder="ここにメモを入力..."></textarea></div>`;
                break;
            case 'paper':
                headerHtml = `<h3 class="font-semibold text-sm truncate pr-2 hover:text-indigo-600 hover:underline cursor-pointer" title="${data.details.title}" data-paper-id="${data.details.paper_id}">${data.details.title}</h3>`;
                const highlightedAbstract = highlightKeywords(data.details.abstract, data.details.keywords);
                const paperBody = `<div class="prose prose-sm max-w-none">
                                        <p><em>Authors: ${data.details.authors.join(', ')}</em> (${data.details.year})</p><hr>
                                        <p><strong>Abstract (キーワード強調):</strong></p>
                                        <div class="p-2 border bg-slate-50 rounded text-xs" style="max-height: 200px; overflow-y: auto;">${highlightedAbstract || 'アブストラクト情報がありません。'}</div>

                                    </div>`;
                bodyHtml = `<div class="component-body p-2">${paperBody}</div><div class="component-memo p-2 border-t border-slate-200 bg-slate-50 rounded-b-md"><textarea class="prose-textarea auto-resize-textarea data-memo-input" placeholder="ここにメモを入力..."></textarea></div>`;
                break;
            default:
                headerHtml = `<h3 class="font-semibold text-sm">${data.name || '不明なブロック'}</h3>`;
                bodyHtml = `<div class="component-body p-2"><p>詳細情報なし</p></div>`;
        }

        component.innerHTML = `<div class="component-content"><div class="component-header">${headerHtml}${controlsHtml}</div>${bodyHtml}</div>`;

        // チャート描画 (author_group用)
        if (data.type === 'author_group' && data.details.timelineData) {
            const chartDiv = component.querySelector('.year-dist-chart');
            // 年代分布データを作成: [[year, count], ...]
            const yearCounts = d3.rollup(data.details.timelineData, v => v.length, d => d.year);
            const yearData = Array.from(yearCounts).sort((a, b) => a[0] - b[0]);
            createYearDistChart(chartDiv, yearData);
        }

        if (data.type === 'topic') {
            const chartContainer = component.querySelector('.year-chart-container');
            if (chartContainer) {
                const yearData = data.details.yearDistribution || [];
                createYearDistChart(chartContainer, yearData);
            }

            const sliderContainer = component.querySelector('.year-range-slider-container');
            const rangeDisplay = component.querySelector('.year-range-display');
            if (sliderContainer && data.details.yearDistribution && data.details.yearDistribution.length > 0) {
                const years = data.details.yearDistribution.map(d => d[0]).sort((a, b) => a - b);
                const minYear = years[0];
                const maxYear = years[years.length - 1];
                const currentRange = data.details.selectedRange || [minYear, maxYear];

                const slider = document.createElement('div');
                sliderContainer.appendChild(slider);

                noUiSlider.create(slider, {
                    start: currentRange,
                    connect: true,
                    range: { 'min': minYear, 'max': maxYear },
                    step: 1,
                    format: {
                        to: val => Math.round(val),
                        from: val => Math.round(val)
                    },
                    tooltips: [true, true]
                });

                const updateDisplay = (values) => {
                    rangeDisplay.textContent = `${values[0]}年 ～ ${values[1]}年`;
                };

                slider.noUiSlider.on('update', updateDisplay);
                updateDisplay(currentRange);
            } else if (rangeDisplay) {
                rangeDisplay.textContent = "年代データなし";
            }

            const keywordContainer = component.querySelector('.focus-keyword-container');
            if (keywordContainer) {
                keywordContainer.addEventListener('click', (e) => {
                    const target = e.target.closest('.focus-keyword-btn');
                    if (!target) return;

                    target.classList.toggle('bg-indigo-600');
                    target.classList.toggle('text-white');
                    target.classList.toggle('border-indigo-600');
                    target.classList.toggle('bg-white');
                    target.classList.toggle('text-slate-700');
                    target.classList.toggle('border-slate-300');
                });
            }
        }



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

    // ★ 修正: addBlock -> addEditorBlock にリネームし、グローバルに公開
    function addEditorBlock(data, targetContainer = canvas) {
        const placeholder = canvas.querySelector('.placeholder-text');
        if (placeholder) placeholder.remove();
        const blockElement = createBlockElement(data);
        targetContainer.appendChild(blockElement);
    }
    // ★ 追加: グローバルスコープに公開
    window.addEditorBlock = addEditorBlock;

    function addTemplateFolders(templateType) {
        const folderNames = TEMPLATES[templateType];
        if (!folderNames) return;
        folderNames.forEach(name => {
            addEditorBlock({ type: 'folder', name: name });
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
        const memoOrContentTextarea = element.querySelector('.data-memo-input');

        if (memoOrContentTextarea) {
            if (data.type === 'paragraph') {
                data.content = memoOrContentTextarea.value;
            } else {
                data.memo = memoOrContentTextarea.value;
            }
        }

        if (data.type === 'folder' || data.type === 'paragraph') {
            data.children = Array.from(childContainer.querySelectorAll(':scope > .component')).map(parseComponent).filter(Boolean);
        } else if (data.type === 'paper') {
            // (paper ノードは変更なし)
        }
        else if (data.type === 'author_group') {
            data.name = titleInput ? titleInput.value : (titleH3 ? titleH3.textContent.trim() : '著者グループ');
            const citationAmountSelect = element.querySelector('.data-citation-amount');
            data.details.citationAmount = citationAmountSelect ? citationAmountSelect.value : 'normal';
            // data.details.authors は dataset.detailsJson からロードされるため、ここでは不要
        }
        else if (data.type === 'author') {
            data.name = titleH3 ? titleH3.textContent.trim() : '不明な著者';
            const citationAmountSelect = element.querySelector('.data-citation-amount');
            data.details.citationAmount = citationAmountSelect ? citationAmountSelect.value : 'normal';
        } else if (data.type === 'topic') {
            const selectedKeywordNodes = element.querySelectorAll('.focus-keyword-btn.bg-indigo-600');
            data.details.selectedKeywords = Array.from(selectedKeywordNodes).map(node => node.dataset.keyword);
            delete data.details.selectedKeyword;

            const slider = element.querySelector('.year-range-slider-container > div');
            if (slider && slider.noUiSlider) {
                data.details.selectedRange = slider.noUiSlider.get().map(v => parseInt(v, 10));
            }
            delete data.details.selectedYear;

            const citationAmountSelect = element.querySelector('.data-citation-amount');
            data.details.citationAmount = citationAmountSelect ? citationAmountSelect.value : 'normal';
        } else {
            return null;
        }
        return data;
    }

    window.getCanvasStructure = function () {
        const canvas = document.getElementById('canvas');
        const topLevelNodes = canvas.querySelectorAll(':scope > .component');
        return Array.from(topLevelNodes).map(parseComponent).filter(Boolean);
    };

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
                    if (!data || !data.type || !data.name) return;

                    let dropTarget = e.target;
                    while (dropTarget && !dropTarget.classList.contains('component-children-container') && dropTarget !== canvas) {
                        dropTarget = dropTarget.parentElement;
                    }
                    if (!dropTarget || (!dropTarget.classList.contains('component-children-container') && dropTarget !== canvas)) {
                        dropTarget = canvas;
                    }

                    if (dropTarget === canvas) {
                        // ★ 修正: author_group もトップレベルに許可
                        if (data.type !== 'paragraph' && data.type !== 'folder' && data.type !== 'author_group') {
                            console.warn('最上位にはパラグラフ、フォルダー、または著者グループのみ追加できます。');
                            return;
                        }
                    }
                    else if (dropTarget.classList.contains('component-children-container')) {
                        if (data.type === 'paragraph' || data.type === 'folder' || data.type === 'author_group') {
                            console.warn('パラグラフまたはフォルダー、著者グループの内部には追加できません。');
                            return;
                        }
                    }

                    addEditorBlock(data, dropTarget);

                } catch (error) { console.error('Failed to parse dropped data:', error); }
            }
        });

        canvas.addEventListener('click', async (e) => {
            const component = e.target.closest('.component');
            if (!component) return;

            if (e.target.closest('.delete-btn')) {
                component.remove();
                if (canvas.querySelectorAll('.component').length === 0) {
                    canvas.innerHTML = `<div class="text-center text-slate-400 placeholder-text"><p class="text-lg font-semibold">ここにブロックを追加</p><p>左の分析結果から知見をドラッグ＆ドロップできます</p></div>`;
                }
            }
            if (e.target.closest('.toggle-collapse-btn')) {
                const button = e.target.closest('.toggle-collapse-btn');
                const body = component.querySelector('.component-body, .component-memo');
                const children = component.querySelector('.component-children-container');

                const isCollapsed = (body && body.style.display === 'none') || (children && children.style.display === 'none');

                if (body) body.style.display = isCollapsed ? '' : 'none';
                if (children) children.style.display = isCollapsed ? '' : 'none';

                button.innerHTML = isCollapsed ? '＋' : '－';
            }

            const summaryBtn = e.target.closest('.generate-summary-btn');
            if (summaryBtn) {
                const outputDiv = component.querySelector('.topic-summary-output');
                if (!outputDiv) return;

                summaryBtn.disabled = true;
                summaryBtn.textContent = '概要を生成中...';
                outputDiv.classList.remove('hidden');
                outputDiv.innerHTML = '<p class="text-slate-500">概要を生成しています...</p>';

                try {
                    const details = JSON.parse(component.dataset.detailsJson || '{}');
                    const allPapers = details.allPapersInTopic || [];

                    if (allPapers.length === 0) {
                        outputDiv.innerHTML = '<p class="text-red-500">概要生成の元になる論文データがありません。</p>';
                        return;
                    }

                    const abstracts = allPapers
                        .map(p => p.abstract)
                        .filter(Boolean)
                        .slice(0, 15)
                        .map(abs => `- ${abs}`)
                        .join('\n');

                    const prompt = `以下の論文アブストラクトのリストに基づき、この研究トピックの概要を、主要な貢献や発見がわかるように2〜3文の日本語で要約してください。\n\n[アブストラクトリスト]\n${abstracts}\n\n[要約]`;

                    if (!window.callGeminiAPI) {
                        outputDiv.innerHTML = '<p class="text-red-500">エラー: API呼び出し関数が見つかりません。</p>';
                        return;
                    }
                    const summaryText = await window.callGeminiAPI(prompt);
                    outputDiv.innerHTML = `<p class="text-slate-700">${summaryText.replace(/\n/g, '<br>')}</p>`;

                } catch (error) {
                    console.error("Summary generation failed:", error);
                    outputDiv.innerHTML = `<p class="text-red-500">概要の生成に失敗しました: ${error.message}</p>`;
                } finally {
                    summaryBtn.disabled = false;
                    summaryBtn.textContent = 'このトピックの概要を生成';
                }
            }


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
            addEditorBlock({ type: 'paragraph', name: '新しいパラグラフ' });
        });
    }

    // --- Dropdown Logic ---
    if (templateDropdownContainer) {
        addFolderDropdownBtn.addEventListener('click', () => {
            templateDropdownMenu.classList.toggle('hidden');
        });

        templateDropdownMenu.addEventListener('click', (e) => {
            e.preventDefault();
            const templateTarget = e.target.closest('a[data-template-type]');
            const singleFolderTarget = e.target.closest('#add-single-folder-btn');

            if (templateTarget) {
                addTemplateFolders(templateTarget.dataset.templateType);
                templateDropdownMenu.classList.add('hidden');
            } else if (singleFolderTarget) {
                addEditorBlock({ type: 'folder', name: '新しいフォルダー' });
                templateDropdownMenu.classList.add('hidden');
            }
        });

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

            window.dispatchEvent(new Event('resize'));
        });
    }

    // --- 文章生成ロジック ---
    if (generateSynthesisBtn) {

        /**
         * paragraphNode（の子）を再帰的に走査し、要求されたデータを収集する
         */
        function collectData(nodes) {
            let collected = { papers: [], topics: [], authors: [], memos: [], relationships: [] };
            if (!nodes) return collected;

            const paperIdsInNode = new Set();
            const allEdges = window.currentVisualizationData ? window.currentVisualizationData.edges : [];
            const allNodesMap = new Map(window.currentVisualizationData ? window.currentVisualizationData.nodes.map(n => [n.paper_id, n]) : []);


            nodes.forEach(node => {
                if (node.type === 'paper') {
                    const paperId = node.details.paper_id;
                    const references = allEdges
                        .filter(e => e.source === paperId && allNodesMap.has(e.target))
                        .map(e => ({ id: e.target, title: allNodesMap.get(e.target).title }));
                    const citedBy = allEdges
                        .filter(e => e.target === paperId && allNodesMap.has(e.source))
                        .map(e => ({ id: e.source, title: allNodesMap.get(e.source).title }));

                    collected.papers.push({
                        id: paperId,
                        title: node.details.title,
                        abstract: node.details.abstract,
                        year: node.details.year,
                        authors: node.details.authors,
                        authorships: node.details.authorships || [],
                        pdf_url: node.details.pdf_url || "",
                        references: references,
                        citedBy: citedBy
                    });
                    paperIdsInNode.add(node.details.paper_id);
                } else if (node.type === 'topic') {
                    const topicPapers = node.details.allPapersInTopic || [];
                    const paperIdsInTopic = new Set();

                    topicPapers.forEach(topicPaper => {
                        const matchedNode = Array.from(allNodesMap.values()).find(n =>
                            n.title === topicPaper.title && n.year === topicPaper.year
                        );
                        if (matchedNode) {
                            paperIdsInTopic.add(matchedNode.paper_id);
                        }
                    });

                    const internalRelationships = allEdges
                        .filter(e => paperIdsInTopic.has(e.source) && paperIdsInTopic.has(e.target))
                        .map(e => ({
                            source: allNodesMap.get(e.source)?.title,
                            target: allNodesMap.get(e.target)?.title
                        }));

                    collected.topics.push({
                        yearDist: node.details.yearDistribution,
                        focusKeywords: node.details.selectedKeywords || [],
                        allPapersInTopic: node.details.allPapersInTopic || [],
                        selectedRange: node.details.selectedRange || null,
                        internalRelationships: internalRelationships,
                        citationAmount: node.details.citationAmount || 'normal'
                    });
                }
                else if (node.type === 'author' || node.type === 'author_group') {

                    if (node.type === 'author_group') {
                        // --- グループの場合の処理 ---
                        // ★ 修正: timelineData (共著論文データ) を直接利用
                        const commonPapers = node.details.timelineData || [];
                        const authorIdsInGroup = (node.details.authors || []).map(a => a.id);

                        // ★ 修正: メンバーが多く所属している論文を優先するようにソート
                        // (論文の著者リストに含まれるグループメンバーの数をカウントし、降順ソート)
                        const sortedCommonPapers = [...commonPapers].sort((a, b) => {
                            const countA = (a.authors || []).filter(auth => authorIdsInGroup.includes(auth)).length;
                            const countB = (b.authors || []).filter(auth => authorIdsInGroup.includes(auth)).length;
                            if (countB !== countA) return countB - countA; // メンバー数が多い順
                            return b.cit_cnt - a.cit_cnt; // 次に引用数
                        });

                        // collected.authors にグループ情報を追加
                        collected.authors.push({
                            name: node.name,
                            isGroup: true,
                            groupMembers: authorIdsInGroup,
                            commonPapers: sortedCommonPapers.map(p => ({
                                title: p.title,
                                year: p.year,
                                abstract: p.abstract || "要約なし"
                            })),
                            // ★ 年代範囲の情報をメタデータとして追加
                            period: commonPapers.length > 0
                                ? `${Math.min(...commonPapers.map(p => p.year))} - ${Math.max(...commonPapers.map(p => p.year))}`
                                : "不明",
                            citationAmount: node.details.citationAmount || 'normal'
                        });

                    } else {
                        // --- 個別著者の場合の処理 (既存) ---
                        const authorData = {
                            id: node.name.replace('著者: ', ''),
                            paper_count: node.details.coauthorCount,
                            mostFrequentTopic: node.details.mostFrequentTopic,
                            coauthoredPapers: node.details.coauthoredPapers || [],
                            citationAmount: node.details.citationAmount || 'normal'
                        };
                        collected.authors.push({
                            name: authorData.id,
                            isGroup: false,
                            coauthorCount: authorData.paper_count,
                            mostFrequentTopic: authorData.mostFrequentTopic,
                            coauthoredPapers: authorData.coauthoredPapers,
                            citationAmount: authorData.citationAmount
                        });
                    }
                }

                if (node.memo) {
                    collected.memos.push(node.memo);
                }
                // 再帰的に子要素を収集
                if (node.children) {
                    const childData = collectData(node.children);
                    collected.papers.push(...childData.papers);
                    collected.topics.push(...childData.topics);
                    collected.authors.push(...childData.authors);
                    collected.memos.push(...childData.memos);
                    collected.relationships.push(...childData.relationships);
                }
            });

            if (allEdges.length > 0) {
                collected.relationships.push(...allEdges.filter(edge =>
                    paperIdsInNode.has(edge.source) && paperIdsInNode.has(edge.target)
                ));
            }

            return collected;
        }


        /**
         * パラグラフノード (folder または paragraph) 1つ分のプロンプトを生成する
         */
        function createParagraphPrompt(paragraphNode, generationStyle, generationFocus) {
            const internalData = collectData(paragraphNode.children || []);
            // author_group自身がトップレベルの場合、そのデータを追加
            if (paragraphNode.type === 'author_group') {
                const selfData = collectData([paragraphNode]);
                internalData.authors.push(...selfData.authors);
            }

            const mainAuthorName = window.currentVisualizationData ? window.currentVisualizationData.main_author_name : "当該研究者";

            let contextInfo = '';
            if (paragraphNode.type === 'paragraph' && paragraphNode.content) {
                contextInfo += `### パラグラフの既存本文（下書き） ###\n"${paragraphNode.content}"\n`;
            }
            if (paragraphNode.type === 'folder' && paragraphNode.memo) {
                contextInfo += `### フォルダー全体のメモ ###\n"${paragraphNode.memo}"\n`;
            }
            // ★ 追加: author_group のメモも収集
            if (paragraphNode.type === 'author_group' && paragraphNode.memo) {
                contextInfo += `### 著者グループ全体のメモ ###\n"${paragraphNode.memo}"\n`;
            }


            let personaPrompt = '';
            switch (generationStyle) {
                case 'academic_general':
                    personaPrompt = `
### ペルソナ設定 ###
あなたは、経験豊富な学術編集者です。
あなたの任務は、与えられた「構成要素」に基づき、一つの流暢で論理的なパラグラフ（本文）を作成することです。
**トーン:** 明快かつ客観的。専門外の読者（他の分野の学者）にも理解できるよう、過度な専門用語を避け、研究の核心的な貢献を平易に説明してください。
`;
                    break;
                case 'frank_summary':
                    personaPrompt = `
### ペルソナ設定 ###
あなたは、${mainAuthorName} 氏の研究に精通した、気さくな研究コミュニケーターです。
あなたの任務は、与えられた「構成要素」を使い、${mainAuthorName} 氏のこの時期の研究が「何を解決しようとして、何を発見したのか」をフランクに説明することです。
**トーン:** 会話風、熱意のこもった、しかし正確。専門用語は避け、比喩や平易な言葉で説明してください。（例：「つまり、${mainAuthorName} 氏がやったのは…」「ここでのブレークスルーは…」）
`;
                    break;
                case 'academic_expert':
                default:
                    personaPrompt = `
### ペルソナ設定 ###
あなたは、経験豊富な学術編集者です。
あなたの任務は、与えられた「構成要素」に基づき、一つの流暢で論理的なパラグラフ（本文）を作成することです。
**トーン:** 学術的、客観的、かつ厳密。この分野の専門家がレビューすることを前提とした、正確な用語と論理構成を使用してください。
`;
                    break;
            }

            // ★ 修正: 焦点（Focus）に関する指示を追加
            let focusPrompt = '';
            if (generationFocus === 'design') {
                focusPrompt = `
### 記述の焦点（Focus） ###
**「論文の設計/特徴重視」**
各論文やトピックに言及する際、研究の時系列（タイムライン）よりも、その研究の「新規性」「独自のアプローチ」「実験設計」「特定の結果」に焦点を当てて記述してください。
`;
            } else { // 'timeline' (デフォルト)
                focusPrompt = `
### 記述の焦点（Focus） ###
**「タイムライン重視」**
各論文やトピックに言及する際、研究の「時系列」や「発展の経緯」が明確になるように記述してください。どの研究がどの研究の基礎となり、どのように発展していったのかという流れを重視してください。
`;
            }


            const prompt = `
${personaPrompt}
${focusPrompt}

### 最重要タスク（厳守） ###
提供される「パラグラフの既存本文（下書き）」または「フォルダー/グループ全体のメモ」は、ユーザーによる最も重要な指示です。
あなたは、これらの指示を「構成要素」のデータよりも優先し、**必ず**反映させなければなりません。
* 「既存本文（下書き）」がある場合：あなたのタスクは、この下書きを**リライト**し、構成要素の情報を追加して洗練させることです。下書きの意図を**絶対に**無視しないでください。
* 「フォルダー/グループ全体のメモ」がある場合：あなたのタスクは、そのメモの指示（例：「○○を強調する」）を**実行**することです。
* 「各構成要素の個別メモ」がある場合：そのメモは、特定の論文やトピックに言及する際の**必須**の指示です。

### メイン著者 ###
${mainAuthorName}

### タイトル ###
"${paragraphNode.name}"

${contextInfo}
### 構成要素（このパラグラフに含めるべき情報） ###
---
[論文ノード] (ID, タイトル, 年, 要旨, PDFリンク, 著者リスト(ポジション情報含む), この論文が引用する論文リスト, この論文を引用する論文リスト): 
${JSON.stringify(internalData.papers.map(p => ({
                id: p.id,
                title: p.title,
                year: p.year,
                abstract: p.abstract,
                pdf_url: p.pdf_url,
                authorships: (p.authorships || []).map(a => ({ name: a.name, position: a.position })),
                references: p.references.map(r => r.title),
                citedBy: p.citedBy.map(c => c.title)
            })))}
---
[トピックノード] (焦点キーワード, 選択年代範囲, 言及する論文数の希望, トピック内の全論文リスト(要旨,引用数,年), トピック内の論文間引用関係):
${JSON.stringify(internalData.topics.map(t => ({
                focusKeywords: t.focusKeywords,
                selectedRange: t.selectedRange,
                citationAmount: t.citationAmount,
                allPapersInTopic: t.allPapersInTopic.map(p => ({
                    title: p.title,
                    abstract: p.abstract,
                    cit_cnt: p.cit_cnt,
                    year: p.year
                })),
                internalRelationships: t.internalRelationships
            })))}
---
[著者・著者グループノード] (名前, グループか?, 詳細):
${JSON.stringify(internalData.authors.map(a => {
                if (a.isGroup) { // ★ グループの場合
                    return {
                        name: a.name,
                        isGroup: true,
                        groupMembers: a.groupMembers,
                        period: a.period, // ★ 活動期間
                        commonPapers: a.commonPapers.map(p => ({ // ★ 共通論文 (時系列)
                            title: p.title,
                            abstract: p.abstract,
                            year: p.year
                        })),
                        citationAmount: a.citationAmount
                    };
                } else { // ★ 個別著者の場合
                    return {
                        name: a.name,
                        isGroup: false,
                        coauthorCount: a.coauthorCount,
                        mostFrequentTopic: a.mostFrequentTopic,
                        citationAmount: a.citationAmount,
                        coauthoredPapers: a.coauthoredPapers.map(p => ({
                            title: p.title,
                            abstract: p.abstract,
                            year: p.year
                        }))
                    };
                }
            }))}
---
[論文間の関係性(パラグラフ内)] (引用): 
${JSON.stringify(internalData.relationships)}
---
[各構成要素の個別メモ]: 
${JSON.stringify(internalData.memos)}
---

### 補助的な指示 ###
1.  **優先順位（★最重要）:** もしこのパラグラフ内に[論文ノード]と[トピックノード]が**両方**含まれている場合、あなたは[論文ノード]で指定された個別の論文（およびその引用関係）を議論の**中心**に据えなければなりません。[トピックノード]の情報（\`allPapersInTopic\`や\`internalRelationships\`）は、それらの中心的な論文の背景、文脈、またはそのトピック全体における位置づけを説明するために**補足的**に使用してください。話が重複しないよう、論文ノードの情報を優先してください。
2.  **論理構成:** まず、このパラグラフに含まれる論文全体の「研究背景」や「問題点」を（各論文の要旨やトピック情報から抽出し）冒頭にまとめて提示してください。その後、時系列や論理の流れ（例えば、アプローチ、結果、考察）に沿って、各論文の貢献を説明してください。単なる情報の羅列を避け、自然な流れになるように接続詞（「しかし」「そのため」「さらに」など）を適切に使用してください。
3.  **時系列と焦点:** \`記述の焦点（Focus）\` の指示（タイムライン重視 vs 設計/特徴重視）に従ってください。特に「著者・著者グループノード」に「活動期間」や「共著論文（時系列）」が含まれる場合は、その年代情報を文脈に反映させてください。（例：「2000年代初頭に集中的に共同研究を行い…」）
4.  **著者中心:** ${mainAuthorName} が（または ${mainAuthorName} を中心とするチームが）何を行ったのか、という視点を明確にしてください。[論文ノード]の \`authorships\` リストを参照し、${mainAuthorName} がその論文でどのような役割（例：'first'（筆頭著者）、'last'（責任著者）、'middle'（共著者））を果たしたかを特定し、記述に反映させてください。（例：${mainAuthorName} が筆頭著者として発表した[論文X]では...）
5.  **著者情報の反映:** 「構成要素」に『著者・著者グループノード』が含まれている場合、その指示に従ってください。
    * **個別著者:** その著者（${mainAuthorName} の共著者）がどのような共同研究（名前、共著論文数、主要トピック、共著論文リスト）を行ったかについて、本文中に具体的に組み込んでください。
    * **著者グループ:** そのグループ（\`name\`, \`groupMembers\`）が、**全員で共著**した論文（\`commonPapers\` リスト）について言及してください。共通論文のリストに基づき、その共同研究の性質（例：特定のテーマ、時期）を要約してください。
6.  **関係性の反映(修正):** 「構成要素」の[論文ノード]には、その論文が引用する論文(\`references\`)と、その論文を引用する論文(\`citedBy\`)のリストが含まれています。また、[論文間の関係性(パラグラフ内)]には、このパラグラフ内の論文同士の引用関係が示されています。これらの情報を利用し、論文間の文脈（例：「この研究は、[論文A]の結果を発展させたものである...」や「[論文B]は、[論文A]に引用されており、後の研究の基礎となった...」）を記述に含めてください。
7.  **参照形式（厳守）:** 「構成要素」に含まれる論文に言及する際は、必ず \`[論文: "論文のタイトル" (ID: paper_id)]\` という形式を使用してください。**構成要素に含まれていない論文を新たに追加で引用しないでください。** ハルシネーションは厳禁です。
8.  **出力:** 指示された内容の文章（パラグラフ）のみとし、余計な前置きや見出しは含めないでください。
9.  **★ 年代の注目:** 「構成要素」の[トピックノード]に \`selectedRange\` (例: \`[2015, 2020]\`) が指定されている場合、その年代範囲（${'${t.selectedRange[0]}'}年～${'${t.selectedRange[1]}'}年）に発表された論文（リスト内の該当する論文）に特に注目し、その時期の研究がどのような意味を持つのかを重点的に記述してください。（例：「特に2015年から2020年にかけて、[論文X]や[論文Y]が発表され、この分野の転換点となった...」）
10. **★ 言及数の調整:** [トピックノード]および[著者・著者グループノード]には、\`citationAmount\` (言及する論文数の希望: 'low' (1-3件), 'normal' (4-5件), 'high' (6件以上)) が指定されています。その指示に従い、各ノードのデータ（\`allPapersInTopic\` や \`coauthoredPapers\`、\`commonPapers\`）から言及する論文の数を調整してください。（論文ノードは必ず言及してください）
11. **改行:** 文章は適度に改行（空行）を入れて、読みやすくしてください。
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

                html += `<h2 class="text-lg font-semibold mt-4 mb-2 border-b pb-1">${node.name}</h2>`;

                let formattedText = text
                    .replace(/^### (.*$)/gim, '<h4 class="font-semibold text-sm mt-2 mb-1">$1</h4>')
                    .replace(/^## (.*$)/gim, '<h3 class="font-semibold text-base mt-3 mb-1">$1</h3>')
                    .replace(/^# (.*$)/gim, '<h2 class="font-semibold text-lg mt-4 mb-2">$1</h2>')
                    .replace(/^\* (.*$)/gim, '<ul><li>$1</li></ul>')
                    .replace(/\n/g, '<br />');

                // リンク生成ロジック
                formattedText = formattedText.replace(
                    /\[論文: "([^"]+)"(?:\s\(([^)]+)\))?\]/g,
                    (match, title, parenthesesContent) => {

                        let paperId = null;
                        const allNodes = window.currentVisualizationData ? window.currentVisualizationData.nodes : [];
                        let paperNode = null;

                        // 1. IDの抽出を試みる
                        if (parenthesesContent) {
                            const idMatch = parenthesesContent.match(/ID:\s*([Ww]\d+)/);
                            if (idMatch && idMatch[1]) {
                                paperId = idMatch[1].trim();
                                paperNode = allNodes.find(p => p.paper_id === paperId);
                            }
                        }

                        // 2. IDで見つからない場合、タイトルで完全一致検索
                        if (!paperNode) {
                            paperNode = allNodes.find(p => p.title.toLowerCase() === title.toLowerCase());
                            if (paperNode) {
                                paperId = paperNode.paper_id;
                            }
                        }

                        // 3. それでも見つからない場合、正規化して部分一致検索（寛容なフォールバック）
                        if (!paperNode) {
                            try {
                                const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
                                if (normalizedTitle.length > 10) { // 短すぎるタイトルでの誤爆を防ぐ
                                    paperNode = allNodes.find(p =>
                                        p.title.toLowerCase().replace(/[^a-z0-9]/g, '').includes(normalizedTitle)
                                    );
                                    if (paperNode) {
                                        paperId = paperNode.paper_id;
                                    }
                                }
                            } catch (e) {
                                console.error("Error during normalized title search:", e);
                            }
                        }


                        if (paperId && paperNode) {
                            const pdfUrl = paperNode.pdf_url;
                            const openAlexUrl = `https://openalex.org/${paperId}`;

                            if (pdfUrl) {
                                return `<a href="${pdfUrl}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:underline" title="PDFを開く">${title}</a>
                                        <span class="paper-link text-xs text-slate-500 hover:underline cursor-pointer ml-1" data-paper-id="${paperId}" title="クリックして左の分析ビューで選択">[分析ビュー]</span>`;
                            } else {
                                return `<a href="${openAlexUrl}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:underline" title="OpenAlexで開く">${title}</a>
                                        <span class="paper-link text-xs text-slate-500 hover:underline cursor-pointer ml-1" data-paper-id="${paperId}" title="クリックして左の分析ビューで選択">[分析ビュー]</span>`;
                            }
                        } else {
                            console.warn(`Could not find paper for: "${title}"`);
                            return `<span class="text-red-600" title="分析データ内に該当する論文が見つかりませんでした">${title}</span>`;
                        }
                    }
                );

                formattedText = formattedText.replace(/<\/ul><br \/><ul>/g, '');

                html += `<div class="generated-section mb-3 pl-3 border-l-4 border-indigo-100">`;

                html += `<div class="prose prose-sm max-w-none text-slate-800">${formattedText}</div>`;
                html += `</div>`;
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
            if (!window.currentVisualizationData) {
                synthesisOutput.innerHTML = '<p class="text-red-500">エラー: 分析データが読み込まれていません。左のパネルで分析を実行してください。</p>';
                return;
            }

            const structure = window.getCanvasStructure();
            if (structure.length === 0) {
                synthesisOutput.innerHTML = '<p class="text-slate-500">文章を生成するには、まず右のツールにブロックを配置してください。</p>';
                return;
            }

            // スタイルと焦点（Focus）を取得
            const styleSelect = document.getElementById('generation-style-select');
            const focusSelect = document.getElementById('generation-focus-select');
            const generationStyle = styleSelect ? styleSelect.value : 'academic_expert';
            const generationFocus = focusSelect ? focusSelect.value : 'timeline';

            synthesisOutput.innerHTML = '<p class="text-slate-500">各パラグラフの文章を並列で生成し、統合しています...</p>';

            try {
                const generationTasks = structure
                    .filter(node => node.type === 'paragraph' || node.type === 'folder' || node.type === 'author_group') // ★ 修正
                    .map(paragraphNode => {
                        const prompt = createParagraphPrompt(paragraphNode, generationStyle, generationFocus); // ★ 修正: 引数を渡す

                        return window.callGeminiAPI(prompt).then(text => {
                            return { node: paragraphNode, text };
                        });
                    });

                const results = await Promise.all(generationTasks);

                const finalHtml = buildHtml(results);
                synthesisOutput.innerHTML = finalHtml;

                synthesisOutput.querySelectorAll('.paper-link').forEach(link => {
                    link.addEventListener('click', (e) => {
                        const paperId = e.target.dataset.paperId;
                        if (paperId) {
                            const event = new CustomEvent('selectPaperFromEditor', {
                                detail: { paperId: paperId },
                                bubbles: true
                            });
                            canvas.dispatchEvent(event);
                        }
                    });
                });

            } catch (error) {
                console.error("Error during synthesis generation:", error);
                synthesisOutput.innerHTML = `<p class="text-red-500">文章生成中にエラーが発生しました: ${error.message}</p>`;
            }
        }

        generateSynthesisBtn.addEventListener('click', handleSynthesisGeneration);
    }

    addEditorBlock({ type: 'paragraph', name: '新しいパラグラフ' });

});