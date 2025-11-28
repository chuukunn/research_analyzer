// coauthor-network.js
// EgoSliderのコンセプトを取り入れた、共著者ネットワークと時系列分析の可視化

/**
 * 共著関係のタイムラインチャートを描画する (EgoSlider風の簡易版)
 * @param {d3.Selection} container 
 * @param {Array} papers - 共著論文のリスト
 * @param {string} label - ラベル
 */
function renderCollaborationTimeline(container, papers, label) {
    container.html(''); // Clear
    const width = container.node().getBoundingClientRect().width;
    const height = 60;
    const margin = { top: 10, right: 10, bottom: 20, left: 10 };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    const svg = container.append("svg")
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // 年代ごとの論文数を集計
    const yearCounts = d3.rollup(papers, v => v.length, d => d.year);
    const years = Array.from(yearCounts.keys()).sort((a, b) => a - b);
    
    // ★ 修正: "No shared timeline" テキストを表示せず、何も描画せずに終了
    if (years.length === 0) {
        return;
    }

    const x = d3.scaleLinear().domain([d3.min(years), d3.max(years)]).range([0, chartW]);
    const y = d3.scaleLinear().domain([0, d3.max(yearCounts.values())]).range([chartH, 0]);

    // 年代軸
    svg.append("g")
        .attr("transform", `translate(0,${chartH})`)
        .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format("d")).tickSize(3))
        .select(".domain").remove();

    // グリフ（円）の描画 - EgoSliderのメタファー
    const data = Array.from(yearCounts).map(([year, count]) => ({ year, count }));
    
    svg.selectAll(".collab-node")
        .data(data)
        .enter().append("circle")
        .attr("cx", d => x(d.year))
        .attr("cy", d => y(d.count))
        .attr("r", d => 2 + Math.sqrt(d.count) * 2) // 数が多いほど大きく
        .attr("fill", "#4f46e5")
        .attr("opacity", 0.7)
        .attr("stroke", "#fff");
    
    // 接続線
    svg.append("path")
        .datum(data.sort((a,b) => a.year - b.year))
        .attr("fill", "none")
        .attr("stroke", "#4f46e5")
        .attr("stroke-width", 1.5)
        .attr("opacity", 0.3)
        .attr("d", d3.line()
            .x(d => x(d.year))
            .y(d => y(d.count))
        );

    svg.append("text")
        .attr("x", 0)
        .attr("y", -2)
        .attr("font-size", "10px")
        .attr("font-weight", "bold")
        .attr("fill", "#333")
        .text(label);
}


/**
 * 右側のパネルに選択された著者間のネットワークを描画する
 * @param {d3.Selection} svg 
 * @param {Object} coAuthorData 
 * @param {Set} selectedAuthorIds 
 * @param {string} mainAuthorName 
 * @param {Object} existingForces 
 * @param {Object} params 
 * @param {string|null} extraAuthorId - ★ 追加: 強制的に表示する追加の著者ID（ターゲット著者など）
 */
function renderSelectedAuthorNetwork(svg, coAuthorData, selectedAuthorIds, mainAuthorName, existingForces, params, extraAuthorId = null) {
    svg.selectAll("*").remove();
    const gMain = svg.append("g");

    const container = svg.node().parentElement;
    if (!container) return null;
    
    const { width: W, height: H } = container.getBoundingClientRect();
    if (W <= 0 || H <= 0) return null;

    // --- ズーム ---
    svg.call(d3.zoom()
        .scaleExtent([0.1, 8])
        .on("zoom", e => gMain.attr("transform", e.transform)));
        
    // --- データフィルタリング ---
    // 表示対象ノード：選択された著者 + 主著者 + 追加著者（ターゲット）
    const targetIds = new Set(selectedAuthorIds);
    targetIds.add(mainAuthorName);
    if (extraAuthorId) targetIds.add(extraAuthorId);

    // ノードが主著者のみ（または主著者とターゲットのみ）の場合はメッセージを出すか、そのまま描画するか
    // ここでは「選択リスト」が空でも、主著者やターゲットがいれば描画するように変更
    // if (selectedAuthorIds.size === 0 && !extraAuthorId) { ... } のようなチェックも考えられるが、
    // グラフとしては主著者だけでも描画可能なので続行する。

    const nodes = coAuthorData.nodes.filter(n => targetIds.has(n.id)).map(n => ({ ...n }));
    
    if (nodes.length <= 1 && selectedAuthorIds.size === 0) {
         gMain.append("text").attr("x", W/2).attr("y", H/2).attr("text-anchor", "middle").text("著者を選択してください。");
         return null;
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    const links = coAuthorData.links
        .filter(l => {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            return targetIds.has(s) && targetIds.has(t);
        })
        .map(l => ({
            source: nodeMap.get(typeof l.source === 'object' ? l.source.id : l.source),
            target: nodeMap.get(typeof l.target === 'object' ? l.target.id : l.target),
            weight: l.weight
        }));

    // --- シミュレーション ---
    const sim = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(100))
        .force("charge", d3.forceManyBody().strength(-300))
        .force("center", d3.forceCenter(W / 2, H / 2))
        .force("collide", d3.forceCollide().radius(d => 15 + Math.sqrt(d.paper_count)));

    // --- 描画 ---
    const link = gMain.append("g").selectAll("line")
        .data(links).enter().append("line")
        .attr("stroke", "#999")
        .attr("stroke-opacity", 0.6)
        .attr("stroke-width", d => Math.sqrt(d.weight));

    const node = gMain.append("g").selectAll("g")
        .data(nodes).enter().append("g")
        .call(d3.drag()
            .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
            .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
            .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

    node.append("circle")
        .attr("r", d => 10 + Math.sqrt(d.paper_count))
        .attr("fill", d => {
            if (d.id === mainAuthorName) return "#ef4444"; // 主著者: 赤
            if (d.id === extraAuthorId) return "#f97316"; // ターゲット: オレンジ
            return "#4f46e5"; // その他: 青
        })
        .attr("stroke", "#fff").attr("stroke-width", 2);

    node.append("text")
        .text(d => d.id)
        .attr("dy", 4)
        .attr("text-anchor", "middle")
        .attr("font-size", "10px")
        .attr("fill", "white")
        .style("pointer-events", "none")
        .style("text-shadow", "1px 1px 2px black");

    sim.on("tick", () => {
        link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    return { sim };
}


/**
 * 左側のパネル：共著者リスト（EgoSlider風リスト）
 */
function renderAuthorRankList(panel, coAuthorData, mainAuthorName, onSelect, selectedAuthorIds, onGroupAdd, onMutualsClick, mutualsTargetAuthor = null) {
    // 全論文データを取得（年代分布計算用）
    const allPapersMap = new Map();
    if (window.currentVisualizationData && window.currentVisualizationData.nodes) {
        window.currentVisualizationData.nodes.forEach(p => allPapersMap.set(p.paper_id, p));
    }

    // --- ヘッダー作成 ---
    let headerHtml = `<div class="p-2 border-b bg-slate-50 sticky top-0 z-10">`;
    
    if (mutualsTargetAuthor) {
        // --- 共通の知人モード ---
        headerHtml += `
            <div class="flex flex-col space-y-2">
                <div class="flex items-center justify-between">
                    <button id="back-to-all-btn" class="text-xs text-indigo-600 hover:underline flex items-center font-bold">
                        ← 戻る
                    </button>
                    <span class="text-xs font-bold text-slate-700 bg-orange-100 px-2 py-1 rounded truncate max-w-[150px]" title="${mutualsTargetAuthor} との共通ネットワーク">
                        ${mutualsTargetAuthor} との共通
                    </span>
                </div>
                <div id="timeline-viz-container" class="w-full h-16 bg-white border rounded"></div>
                <div class="flex justify-between items-center mt-1">
                    <span class="text-xs text-slate-500" id="mutual-count-display"></span>
                    <button id="add-author-group-btn" class="bg-indigo-600 text-white font-semibold py-1 px-3 rounded-md hover:bg-indigo-700 text-xs">
                        グループ追加
                    </button>
                </div>
            </div>
        `;
    } else {
        // --- 通常モード (Main Ego's Network) ---
        headerHtml += `
            <div class="flex flex-col space-y-2">
                <div class="flex justify-between items-center">
                    <h3 class="font-semibold text-sm">共著者リスト</h3>
                    <span class="text-xs text-slate-400">クリックして探索</span>
                </div>
                <input type="text" id="author-search-input" placeholder="名前で検索..." class="text-xs border rounded p-1 w-full">
            </div>
        `;
    }
    headerHtml += `</div>`;
    panel.innerHTML = headerHtml;

    // --- リストデータの準備 ---
    let authorsToShow = [];
    let commonPapersForTimeline = [];

    if (mutualsTargetAuthor) {
        // Mutualモード: ターゲットとの共通の知人を抽出
        // 1. ターゲットの隣接ノードを取得
        const targetNeighbors = new Set();
        coAuthorData.links.forEach(l => {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            if (s === mutualsTargetAuthor) targetNeighbors.add(t);
            if (t === mutualsTargetAuthor) targetNeighbors.add(s);
        });
        
        // 2. 「主著者」の共著者リスト(coAuthorData.nodes)の中で、ターゲットとも繋がっている人を抽出
        // (注: coAuthorData.nodesは既に主著者の1-hop近傍)
        authorsToShow = coAuthorData.nodes.filter(n => targetNeighbors.has(n.id));
        
        // ★ 修正: ターゲット著者自身はリスト（下のランキング）からは除外する
        // （ヘッダーに表示されているため、重複して表示しない。ただしグラフには表示する）
        authorsToShow = authorsToShow.filter(n => n.id !== mutualsTargetAuthor);

        // ★ 修正: 共著者数でソート (降順)
        authorsToShow.sort((a, b) => b.paper_count - a.paper_count);

        // --- タイムライン用データ: 主著者とターゲット(およびその周辺)の共著論文 ---
        if (allPapersMap.size > 0) {
             allPapersMap.forEach(p => {
                 const authors = new Set(p.authors || []);
                 if (authors.has(mainAuthorName) && authors.has(mutualsTargetAuthor)) {
                     commonPapersForTimeline.push(p);
                 }
             });
        }
        
        // タイムライン描画
        const timelineContainer = d3.select(panel.querySelector('#timeline-viz-container'));
        renderCollaborationTimeline(timelineContainer, commonPapersForTimeline, `${mainAuthorName} & ${mutualsTargetAuthor}`);
        
        panel.querySelector('#mutual-count-display').textContent = `${authorsToShow.length}名の共通の知人`;

    } else {
        // 通常モード: 主著者はリストから除外
        authorsToShow = [...coAuthorData.nodes].filter(n => n.id !== mainAuthorName);
        authorsToShow.sort((a, b) => b.paper_count - a.paper_count);
    }

    // --- リスト描画 ---
    const listContainer = document.createElement('div');
    listContainer.className = "overflow-y-auto flex-grow";
    const ul = document.createElement('ul');
    ul.className = "divide-y divide-slate-100";

    // 検索フィルタ
    const searchInput = panel.querySelector('#author-search-input');
    
    const renderListItems = (filterText = "") => {
        ul.innerHTML = "";
        const filtered = authorsToShow.filter(a => a.id.toLowerCase().includes(filterText.toLowerCase()));
        
        if (filtered.length === 0) {
            ul.innerHTML = '<li class="p-4 text-xs text-slate-400 text-center">該当者なし</li>';
            return;
        }

        filtered.forEach(author => {
            const li = document.createElement('li');
            const isSelected = selectedAuthorIds.has(author.id);
            
            li.className = `p-2 hover:bg-slate-50 cursor-pointer transition-colors flex justify-between items-center ${isSelected ? 'bg-indigo-50 border-l-4 border-indigo-500' : ''}`;
            
            // 左側：名前とバッジ
            const leftDiv = document.createElement('div');
            leftDiv.className = "flex flex-col overflow-hidden";
            
            const nameSpan = document.createElement('span');
            nameSpan.className = `text-sm font-medium text-slate-700 truncate`;
            nameSpan.textContent = author.id;
            nameSpan.title = author.id;
            
            const metaSpan = document.createElement('span');
            metaSpan.className = "text-xs text-slate-400";
            metaSpan.textContent = `${author.start_year}-${author.end_year} • ${author.paper_count} papers`;
            
            leftDiv.appendChild(nameSpan);
            leftDiv.appendChild(metaSpan);

            // 右側：アクションボタン
            const rightDiv = document.createElement('div');
            rightDiv.className = "flex-shrink-0 ml-2";
            
            if (!mutualsTargetAuthor) {
                // 通常モード: 「深掘り」ボタン
                const drillBtn = document.createElement('button');
                drillBtn.className = "text-xs bg-white border border-slate-300 px-2 py-1 rounded hover:bg-slate-100 text-slate-600";
                drillBtn.innerHTML = "詳細 ▶";
                drillBtn.onclick = (e) => {
                    e.stopPropagation();
                    onMutualsClick(author.id);
                };
                rightDiv.appendChild(drillBtn);
            } else {
                // Mutualモード: 選択チェックボックス
                const check = document.createElement('input');
                check.type = "checkbox";
                check.checked = isSelected;
                check.className = "form-checkbox h-4 w-4 text-indigo-600 transition duration-150 ease-in-out";
                check.onclick = (e) => e.stopPropagation(); // 親のクリックイベントと重複しないように
                check.onchange = () => onSelect(author.id);
                rightDiv.appendChild(check);
            }

            li.appendChild(leftDiv);
            li.appendChild(rightDiv);
            
            // 行クリックでも選択（Mutualモードの場合）または深掘り（通常モードの場合）
            li.onclick = () => {
                if (mutualsTargetAuthor) {
                    onSelect(author.id);
                } else {
                    onMutualsClick(author.id);
                }
            };

            ul.appendChild(li);
        });
    };

    renderListItems();
    if (searchInput) {
        searchInput.addEventListener('input', (e) => renderListItems(e.target.value));
    }

    listContainer.appendChild(ul);
    panel.appendChild(listContainer);

    // --- イベントリスナー ---
    const backBtn = panel.querySelector('#back-to-all-btn');
    if (backBtn) {
        backBtn.onclick = () => onMutualsClick(null);
    }

    const groupAddBtn = panel.querySelector('#add-author-group-btn');
    if (groupAddBtn) {
        groupAddBtn.onclick = () => {
            // グループ追加時に、年代情報(commonPapersForTimeline)も渡す
            onGroupAdd(commonPapersForTimeline);
        };
    }
}


/**
 * メイン関数
 */
function renderCoauthorTimeline(containerDiv, data, state, callbacks) {
    const { co_author_data, main_author_name } = data;
    const { onAuthorGroupAdd } = callbacks;
    
    const container = containerDiv.node();
    if (!container) return;

    // 初期化
    container.innerHTML = '';
    container.className = 'flex flex-row w-full h-full'; // 横並びレイアウト

    // 左パネル（リスト）
    const leftPanel = document.createElement('div');
    leftPanel.className = 'w-1/3 h-full border-r bg-white flex flex-col shadow-sm z-10';
    container.appendChild(leftPanel);

    // 右パネル（グラフ）
    const rightPanel = document.createElement('div');
    rightPanel.className = 'w-2/3 h-full relative bg-slate-50';
    container.appendChild(rightPanel);

    const svgElement = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgElement.setAttribute('width', '100%');
    svgElement.setAttribute('height', '100%');
    rightPanel.appendChild(svgElement);
    const svg = d3.select(svgElement);

    // 状態管理
    let selectedAuthorIds = new Set();
    let mutualsTargetAuthor = null;
    let sim = null;

    // ビュー更新関数
    const updateView = () => {
        // リスト再描画
        renderAuthorRankList(
            leftPanel,
            co_author_data,
            main_author_name,
            (id) => { // onSelect
                if (selectedAuthorIds.has(id)) selectedAuthorIds.delete(id);
                else selectedAuthorIds.add(id);
                updateView();
            },
            selectedAuthorIds,
            (timelinePapers) => { // onGroupAdd
                if (selectedAuthorIds.size > 0 && onAuthorGroupAdd) {
                    onAuthorGroupAdd(Array.from(selectedAuthorIds), timelinePapers);
                }
            },
            (targetId) => { // onMutualsClick
                mutualsTargetAuthor = targetId;
                selectedAuthorIds.clear();
                // ターゲット著者はリストから除外されるが、内部的には選択状態に含めない
                // (グラフ描画側で extraAuthorId として渡すため)
                updateView();
            },
            mutualsTargetAuthor
        );

        // グラフ再描画
        const forces = renderSelectedAuthorNetwork(
            svg,
            co_author_data,
            selectedAuthorIds,
            main_author_name,
            { sim },
            {},
            mutualsTargetAuthor // ★ 修正: ターゲット著者を明示的に渡してグラフには常に表示させる
        );
        if (forces) sim = forces.sim;
    };

    updateView();
}