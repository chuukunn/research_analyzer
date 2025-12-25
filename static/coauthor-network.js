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
        .attr("r", 4) // 固定サイズ (バブルチャート廃止)
        .attr("fill", "#4f46e5")
        .attr("opacity", 0.7)
        .attr("stroke", "#fff");

    // 接続線
    svg.append("path")
        .datum(data.sort((a, b) => a.year - b.year))
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
 * @param {Object} params 
 * @param {string|null} extraAuthorId - ★ 追加: 強制的に表示する追加の著者ID（ターゲット著者など）
 * @param {boolean} showLinkLabels - ★ 追加: リンクのラベル（論文数）を表示するかどうか
 */
function renderSelectedAuthorNetwork(svg, coAuthorData, selectedAuthorIds, mainAuthorName, existingForces, params, extraAuthorId = null, showLinkLabels = true, showMainAuthor = true) {
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
    if (showMainAuthor) {
        targetIds.add(mainAuthorName);
    }
    if (extraAuthorId) targetIds.add(extraAuthorId);

    // ノードが主著者のみ（または主著者とターゲットのみ）の場合はメッセージを出すか、そのまま描画するか
    // ここでは「選択リスト」が空でも、主著者やターゲットがいれば描画するように変更
    // if (selectedAuthorIds.size === 0 && !extraAuthorId) { ... } のようなチェックも考えられるが、
    // グラフとしては主著者だけでも描画可能なので続行する。

    const nodes = coAuthorData.nodes.filter(n => targetIds.has(n.id)).map(n => ({ ...n }));

    // ★ Main Author Node Injection ★
    // Ensure main author is in the nodes list if not already (it shouldn't be in coAuthorData.nodes usually)
    if (showMainAuthor) {
        let mainNode = nodes.find(n => n.id === mainAuthorName);
        if (!mainNode) {
            mainNode = {
                id: mainAuthorName,
                paper_count: d3.max(nodes, n => n.paper_count) || 10, // Dummy count for size
                start_year: d3.min(nodes, n => n.start_year),
                end_year: d3.max(nodes, n => n.end_year),
                fx: W / 2, // Fix to center initially
                fy: H / 2
            };
            nodes.push(mainNode);
        }
    }

    // Refresh map with new node
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // Existing links
    const existingLinks = coAuthorData.links
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

    // ★ Synthetic Links to Main Author ★
    const mainLinks = [];
    if (showMainAuthor) {
        nodes.forEach(n => {
            if (n.id !== mainAuthorName) {
                // Check if link already exists (unlikely for ego net data structure, but good safety)
                // Actually, normally coAuthorData only has co-author <-> co-author links? 
                // Or does it have Main <-> Co-author? 
                // Analyzer.py usually returns co-author <-> co-author edges.
                // So we add Main <-> Co-author here.
                const sNode = nodeMap.get(mainAuthorName);
                const tNode = nodeMap.get(n.id);
                if (sNode && tNode) {
                    mainLinks.push({
                        source: sNode,
                        target: tNode,
                        weight: n.paper_count // Weight is the number of shared papers
                    });
                }
            }
        });
    }

    const links = [...existingLinks, ...mainLinks];

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
        .attr("stroke", "#999")
        .attr("stroke-opacity", 0.6)
        .attr("stroke-width", d => Math.sqrt(d.weight));

    // リンクのラベル（論文数を表示）
    const linkLabel = gMain.append("g").selectAll("text")
        .data(links).enter().append("text")
        .text(d => d.weight)
        .attr("text-anchor", "middle")
        .attr("font-size", "10px")
        .attr("fill", "#555")
        .style("opacity", showLinkLabels ? 1 : 0) // トグルで表示切り替え
        .style("pointer-events", "none")
        .style("paint-order", "stroke")
        .style("stroke", "white")
        .style("stroke-width", "3px")
        .style("stroke-linecap", "butt")
        .style("stroke-linejoin", "miter");

    const node = gMain.append("g").selectAll("g")
        .data(nodes).enter().append("g")
        .call(d3.drag()
            .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
            .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
            .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

    node.append("circle")
        .attr("r", d => {
            if (d.id === mainAuthorName) return 20; // 主著者は大きく
            return 10 + Math.sqrt(d.paper_count);
        })
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
        .attr("fill", "black")
        .attr("stroke", "white")
        .attr("stroke-width", "3px")
        .style("paint-order", "stroke")
        .style("pointer-events", "none");

    sim.on("tick", () => {
        link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);

        linkLabel
            .attr("x", d => (d.source.x + d.target.x) / 2)
            .attr("y", d => (d.source.y + d.target.y) / 2);

        node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    return { sim };
}


/**
 * 左側のパネル：共著者リスト（EgoSlider風リスト）
 */
/**
 * 左側のパネル：共著者リスト（EgoSlider風リスト）
 */
function renderAuthorRankList(panel, coAuthorData, mainAuthorName, onSelect, selectedAuthorIds, onGroupAdd, onMutualsClick, onAuthorClick, mutualsTargetAuthor = null) {
    // 全論文データを取得（年代分布計算用）
    const allPapersMap = new Map();
    if (window.currentVisualizationData) {
        if (window.currentVisualizationData.papers) {
            Object.values(window.currentVisualizationData.papers).forEach(p => allPapersMap.set(p.paper_id, p));
        } else if (window.currentVisualizationData.nodes) {
            window.currentVisualizationData.nodes.forEach(p => allPapersMap.set(p.paper_id, p));
        }
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
                    <button id="add-author-group-btn" class="bg-indigo-600 text-white font-semibold py-1 px-3 rounded-md hover:bg-indigo-700 text-xs">
                        グループ追加
                    </button>
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
            rightDiv.className = "flex-shrink-0 ml-2 flex items-center gap-1";

            // ★ 追加: Global Selectionへの追加ボタン
            const addToSelectBtn = document.createElement('button');
            addToSelectBtn.className = "text-xs hover:bg-slate-200 text-slate-500 hover:text-indigo-600 px-1 rounded font-bold";
            addToSelectBtn.title = "現在の選択(左パネル)に追加";
            addToSelectBtn.innerHTML = "＋";
            addToSelectBtn.onclick = (e) => {
                e.stopPropagation();
                if (onAuthorClick) onAuthorClick(author.id, true); // true = accumulate
            };
            rightDiv.appendChild(addToSelectBtn);

            if (!mutualsTargetAuthor) {
                // 通常モード: チェックボックス（選択）トグル + 「詳細」ボタン（深掘り）
                // チェックボックス
                const check = document.createElement('input');
                check.type = "checkbox";
                check.checked = isSelected;
                check.className = "form-checkbox h-4 w-4 text-indigo-600 transition duration-150 ease-in-out mr-2 align-middle";
                check.onclick = (e) => e.stopPropagation();
                check.onchange = () => onSelect(author.id);
                rightDiv.appendChild(check);

                // 詳細ボタン
                const drillBtn = document.createElement('button');
                drillBtn.className = "text-xs bg-white border border-slate-300 px-2 py-1 rounded hover:bg-slate-100 text-slate-600 align-middle";
                drillBtn.innerHTML = "詳細 ▶";
                drillBtn.onclick = (e) => {
                    e.stopPropagation();
                    onMutualsClick(author.id);
                };
                rightDiv.appendChild(drillBtn);
            } else {
                // Mutualモード: 選択チェックボックスのみ
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
            // mutualsTargetAuthorがいる場合: [main, target]
            // いない場合: selectedAuthorIds
            if (mutualsTargetAuthor) {
                // Mutualモード: ターゲットとの共通論文、メンバーはターゲット自身＋自分＋選択された人
                //  (仕様確認: MainとTargetのペア? それともリストに表示されている人たち?)
                //  -> ここでは「Main著者」「ターゲット著者」および「選択された著者」を含めたグループとする
                const ids = new Set([mainAuthorName, mutualsTargetAuthor, ...selectedAuthorIds]);
                onGroupAdd(commonPapersForTimeline, Array.from(ids));
            } else {
                // 通常モード: 選択された著者たちとのグループ
                if (selectedAuthorIds.size === 0) {
                    alert("著者を選択してください。");
                    return;
                }
                const selectedIdsArr = Array.from(selectedAuthorIds);
                // Main著者も含める
                const groupIds = [mainAuthorName, ...selectedIdsArr];

                // 選択された著者全員とMain著者に関連する論文を収集
                // (簡易的に、Main著者が含まれ、かつ選択された著者のいずれかが含まれる論文)
                const groupPapers = [];
                if (allPapersMap.size > 0) {
                    allPapersMap.forEach(p => {
                        const authors = new Set(p.authors || []);
                        const hasMain = authors.has(mainAuthorName);
                        const isPaperMode = mainAuthorName.startsWith("[Paper]");

                        // Main著者が共著者に含まれるか、またはSinglePaperモードである場合
                        // かつ、選択された著者の誰かが含まれていればOK
                        if ((hasMain || isPaperMode) && selectedIdsArr.some(id => authors.has(id))) {
                            groupPapers.push(p);
                        }
                    });
                }
                onGroupAdd(groupPapers, groupIds);
            }
        };
    }
}


/**
 * メイン関数
 */
function renderCoauthorTimeline(containerDiv, data, state, callbacks) {
    const { co_author_data, main_author_name } = data;
    const { onAuthorGroupAdd, onAuthorClick } = callbacks; // onAuthorClickを受け取る

    const container = containerDiv.node();
    if (!container) return;

    // 初期化
    container.innerHTML = '';
    container.className = 'flex flex-row w-full h-full'; // 横並びレイアウト

    // 左パネル（リスト）
    // 左パネル（リスト）
    const leftPanel = document.createElement('div');
    // resizeは自前でやるため、CSS resizeは削除
    leftPanel.className = 'border-r bg-white flex flex-col shadow-sm z-10 flex-none';
    leftPanel.style.width = '33%';
    leftPanel.style.minWidth = '200px';
    leftPanel.style.maxWidth = '80%';
    // leftPanel.style.resize = 'horizontal'; // Removed
    leftPanel.style.overflow = 'hidden'; // 内部スクロールはlistContainerでやる

    container.appendChild(leftPanel);

    // Splitter (Resizer)
    const splitter = document.createElement('div');
    splitter.className = "w-1 h-full cursor-col-resize bg-slate-200 hover:bg-indigo-400 flex-none transition-colors z-20";
    container.appendChild(splitter);

    // 右パネル（グラフ）
    const rightPanel = document.createElement('div');
    rightPanel.className = 'flex-auto h-full relative bg-slate-50 overflow-hidden';
    container.appendChild(rightPanel);

    // --- Splitter Logic ---
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    splitter.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = leftPanel.getBoundingClientRect().width;
        splitter.classList.add('bg-indigo-500'); // Active color
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const deltaX = e.clientX - startX;
        // container width check
        const containerWidth = container.getBoundingClientRect().width;
        const newWidth = Math.max(200, Math.min(startWidth + deltaX, containerWidth * 0.8));
        leftPanel.style.width = `${newWidth}px`;
        e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            splitter.classList.remove('bg-indigo-500');
            document.body.style.cursor = '';
        }
    });
    // ---------------------

    // --- Graph Header (Options) ---
    const graphHeader = document.createElement('div');
    graphHeader.className = "absolute top-2 right-2 z-10 bg-white/80 p-2 rounded shadow flex items-center gap-2";

    const countToggleLabel = document.createElement('label');
    countToggleLabel.className = "inline-flex items-center cursor-pointer text-xs text-slate-600";
    const countToggle = document.createElement('input');
    countToggle.type = "checkbox";
    countToggle.checked = true; // Default ON
    countToggle.className = "form-checkbox h-3 w-3 text-indigo-600 mr-1";
    countToggle.onchange = (e) => {
        showLinkLabels = e.target.checked;
        updateView();
    };
    countToggleLabel.appendChild(countToggle);
    countToggleLabel.appendChild(document.createTextNode("数値を表示"));
    graphHeader.appendChild(countToggleLabel);

    // ★ Main Author Toggle
    const mainToggleLabel = document.createElement('label');
    mainToggleLabel.className = "inline-flex items-center cursor-pointer text-xs text-slate-600 ml-2";
    const mainToggle = document.createElement('input');
    mainToggle.type = "checkbox";
    mainToggle.checked = true; // Default ON
    mainToggle.className = "form-checkbox h-3 w-3 text-indigo-600 mr-1";
    mainToggle.onchange = (e) => {
        showMainAuthor = e.target.checked;
        updateView();
    };
    mainToggleLabel.appendChild(mainToggle);
    mainToggleLabel.appendChild(document.createTextNode("中心を含める"));
    graphHeader.appendChild(mainToggleLabel);


    rightPanel.appendChild(graphHeader);
    // -----------------------------

    const svgElement = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgElement.setAttribute('width', '100%');
    svgElement.setAttribute('height', '100%');
    rightPanel.appendChild(svgElement);
    const svg = d3.select(svgElement);

    // 状態管理
    let selectedAuthorIds = new Set();
    let mutualsTargetAuthor = null; // nullなら通常モード、IDならその人とのCommonモード
    let showLinkLabels = true;
    let showMainAuthor = true; // ★ 新規
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
            (timelinePapers, passedIds) => { // onGroupAdd
                const ids = passedIds || Array.from(selectedAuthorIds);
                if ((ids.length > 0 || Array.isArray(ids)) && onAuthorGroupAdd) {
                    onAuthorGroupAdd(timelinePapers, ids);
                }
            },
            (targetId) => { // onMutualsClick
                mutualsTargetAuthor = targetId;
                selectedAuthorIds.clear();
                // ターゲット著者はリストから除外されるが、内部的には選択状態に含めない
                // (グラフ描画側で extraAuthorId として渡すため)
                updateView();
            },
            onAuthorClick, // Pass down
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
            mutualsTargetAuthor, // ★ 修正: ターゲット著者を明示的に渡してグラフには常に表示させる
            showLinkLabels, // ★ 新規: トグル状態を渡す
            showMainAuthor // ★ 新規: メイン著者の表示状態
        );
        if (forces) sim = forces.sim;
    };

    updateView();
}