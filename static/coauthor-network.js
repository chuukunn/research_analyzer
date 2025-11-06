// coauthor-network.js
// タイムライン表示から「共著者ランキング」と「エゴネットワーク」の表示に機能を変更

/**
 * 右側のパネルにエゴイスティックネットワークを描画する（★ 順次追加アニメーション付き）
 * @param {d3.Selection} svg - ネットワークを描画するSVG要素
 * @param {object} coAuthorData - 共著者データ (nodes, links)
 * @param {string | null} selectedAuthorId - 選択された中心著者のID
 * @param {string} mainAuthorName - 調査対象（主著者）のID
 */
function renderEgoNetwork(svg, coAuthorData, selectedAuthorId, mainAuthorName) {
    svg.selectAll("*").remove();
    const gMain = svg.append("g");

    const container = svg.node().parentElement;
    if (!container) return;
    
    const { width: W, height: H } = container.getBoundingClientRect();
    if (W <= 0 || H <= 0) return;

    // --- ズーム ---
    svg.call(d3.zoom()
        .scaleExtent([0.1, 8])
        .on("zoom", e => gMain.attr("transform", e.transform)));
        
    // --- 初期メッセージ ---
    if (!selectedAuthorId || !coAuthorData.nodes || !coAuthorData.links) {
        gMain.append("text")
            .attr("x", W / 2)
            .attr("y", H / 2)
            .attr("text-anchor", "middle")
            .style("font-size", "14px")
            .text("左のリストから著者を選択してください。");
        return;
    }

    // --- 1. データ抽出 ---
    const centerNode = coAuthorData.nodes.find(n => n.id === selectedAuthorId);
    if (!centerNode) {
         gMain.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle").text("著者データが見つかりません。");
        return;
    }
    
    const neighborLinksData = coAuthorData.links.filter(l => 
        (l.source === selectedAuthorId || l.target === selectedAuthorId) &&
        coAuthorData.nodes.find(n => n.id === l.source) &&
        coAuthorData.nodes.find(n => n.id === l.target)
    );
    
    const neighborIds = new Set(
        neighborLinksData.map(l => l.source === selectedAuthorId ? l.target : l.source)
    );

    // ★ 修正: 順次追加するため、シャッフルしておく
    const neighborNodesData = coAuthorData.nodes
        .filter(n => neighborIds.has(n.id))
        .sort(() => 0.5 - Math.random()); // シャッフル

    // --- 2. シミュレーション設定 ---
    const currentNodes = [];
    const currentLinks = [];
    
    const nodeMap = new Map(); // 現在表示中のノードを管理

    const sim = d3.forceSimulation(currentNodes)
        .force("link", d3.forceLink(currentLinks).id(d => d.id).distance(100).strength(l => 0.1 + (l.weight / 10)))
        .force("charge", d3.forceManyBody().strength(-400))
        .force("collision", d3.forceCollide().radius(d => 10 + Math.sqrt(d.paper_count) * 2 + 5))
        .force("center", d3.forceCenter(W / 2, H / 2));

    // --- 3. 描画グループ ---
    const linkGroup = gMain.append("g").attr("class", "links");
    const nodeGroup = gMain.append("g").attr("class", "nodes");
    
    let link = linkGroup.selectAll(".link");
    let node = nodeGroup.selectAll(".node");

    // --- 4. Tick関数 ---
    sim.on("tick", () => {
        link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        node.attr("transform", d => `translate(${d.x},${d.y})`);
    });
    
    // --- 5. 再描画・シミュレーション再起動 関数 ---
    function restartSimulation() {
        // --- ノードのData Join ---
        node = node.data(currentNodes, d => d.id);
        node.exit().remove();
        
        const nodeEnter = node.enter().append("g")
            .attr("class", "node")
            .style("opacity", 0) // ★ 初期透明度 0
            .call(d3.drag()
                .on("start", (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
                .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
                .on("end", (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
            );

        const isMainAuthorSelected = selectedAuthorId === mainAuthorName;

        nodeEnter.append("circle")
            .attr("r", d => 10 + Math.sqrt(d.paper_count) * 2)
            .attr("fill", d => {
                if (d.id === selectedAuthorId) {
                    return isMainAuthorSelected ? "#b91c1c" : "#4f46e5"; // Red-700 or Indigo-600
                }
                return "#6366f1"; // Indigo-500
            })
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5);
            
        nodeEnter.append("text")
            .attr("dy", ".35em")
            .attr("text-anchor", "middle")
            .style("font-size", d => d.id === selectedAuthorId ? (isMainAuthorSelected ? "14px" : "12px") : "10px")
            .style("font-weight", d => d.id === selectedAuthorId ? "bold" : "normal")
            .style("fill", d => d.id === selectedAuthorId ? "#ffffff" : "#000000") 
            .style("paint-order", "stroke")
            .style("stroke", d => d.id === selectedAuthorId ? "none" : "#ffffff")
            .style("stroke-width", d => d.id === selectedAuthorId ? "0" : "3px")
            .style("stroke-linejoin", "round")
            .text(d => d.id);

        nodeEnter.append("title")
            .text(d => `${d.id}\n共著論文数: ${d.paper_count}\n活動期間: ${d.start_year} - ${d.end_year}`);

        // ★ 新旧ノードをマージし、フェードイン
        node = nodeEnter.merge(node);
        node.transition().duration(300).style("opacity", 1);

        // --- リンクのData Join ---
        link = link.data(currentLinks, d => `${d.source.id}-${d.target.id}`);
        link.exit().remove();
        
        const linkEnter = link.enter().append("line")
            .attr("class", "link")
            .attr("stroke", "#999")
            .attr("stroke-opacity", 0) // ★ 初期透明度 0
            .attr("stroke-width", d => Math.sqrt(d.weight));
        
        // ★ 新旧リンクをマージし、フェードイン
        link = linkEnter.merge(link);
        link.transition().duration(300).style("stroke-opacity", 0.6);

        // --- シミュレーションの更新 ---
        sim.nodes(currentNodes);
        sim.force("link").links(currentLinks);
        sim.alpha(0.5).restart();
    }

    // --- 6. 順次追加アニメーションの実行 ---
    
    // 最初に中心ノードを追加
    const centerNodeCopy = { ...centerNode };
    currentNodes.push(centerNodeCopy);
    nodeMap.set(centerNodeCopy.id, centerNodeCopy);
    restartSimulation();

    let nodeIndex = 0;
    const intervalTime = 150; // ノードを追加する間隔 (ms)

    const addNodeInterval = d3.interval(() => {
        if (nodeIndex >= neighborNodesData.length) {
            addNodeInterval.stop(); // 全ノード追加完了
            return;
        }

        // 新しいノード（コピー）を追加
        const newNodeData = neighborNodesData[nodeIndex];
        const newNode = { ...newNodeData };
        currentNodes.push(newNode);
        nodeMap.set(newNode.id, newNode);

        // このノードに関連するリンク（すでに表示されているノードとのリンク）を追加
        neighborLinksData.forEach(l => {
            const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
            const targetId = typeof l.target === 'object' ? l.target.id : l.target;

            // 新規ノードと既存ノード間のリンクか？
            if (sourceId === newNode.id && nodeMap.has(targetId)) {
                currentLinks.push({ source: nodeMap.get(sourceId), target: nodeMap.get(targetId), weight: l.weight });
            } else if (targetId === newNode.id && nodeMap.has(sourceId)) {
                currentLinks.push({ source: nodeMap.get(sourceId), target: nodeMap.get(targetId), weight: l.weight });
            }
        });

        restartSimulation();
        nodeIndex++;

    }, intervalTime);
}


/**
 * ★ 削除: renderFullCoauthorNetwork 関数は renderEgoNetwork に統合されたため削除
 */
// function renderFullCoauthorNetwork(svg, coAuthorData, mainAuthorName) { ... }


/**
 * 左側のパネルに共著者ランキングを描画する
 * @param {HTMLElement} panel - ランキングを描画するHTML要素
 * @param {object} coAuthorData - 共著者データ (nodes, links)
 * @param {string} mainAuthorName - 主著者の名前
 * @param {function} onSelect - 著者が選択されたときのコールバック (authorId を引数)
 * @param {string | null} selectedAuthorId - 現在選択されている著者のID
 */
function renderAuthorRankList(panel, coAuthorData, mainAuthorName, onSelect, selectedAuthorId) {
    panel.innerHTML = '<h3 class="font-semibold text-lg mb-2 p-2">著者ランキング</h3>';
    
    if (!coAuthorData || !coAuthorData.nodes) {
        panel.innerHTML += '<p class="text-slate-500 p-2">著者データがありません。</p>';
        return;
    }

    const list = document.createElement('ul');
    list.className = "space-y-1";
    
    // ★ 修正: analyzer.py が主著者も返すようになったため、allPapers は不要
    const authors = [...coAuthorData.nodes].filter(n => n.id && n.paper_count > 0);

    // ★ 修正: 主著者を特定し、フラグを立て、リストの先頭に移動
    const mainAuthorIndex = authors.findIndex(a => a.id === mainAuthorName);
    if (mainAuthorIndex > -1) {
        const mainAuthorNode = authors.splice(mainAuthorIndex, 1)[0];
        mainAuthorNode.isMainAuthor = true;
        // paper_count でソートした後、先頭に追加
        authors.sort((a, b) => b.paper_count - a.paper_count);
        authors.unshift(mainAuthorNode);
    } else {
        // 主著者が見つからない場合（通常あり得ないが）、単純にソート
        authors.sort((a, b) => b.paper_count - a.paper_count);
    }

    authors.forEach(author => {
        const li = document.createElement('li');
        let text = `${author.id} (${author.paper_count}件)`;
        if (author.isMainAuthor) {
            text += " [調査対象]";
        }
        li.textContent = text;
        
        const isSelected = author.id === selectedAuthorId;
        
        li.className = `text-sm p-2 rounded-md cursor-pointer transition-colors ${
            isSelected 
                ? 'bg-indigo-600 text-white font-semibold' 
                : (author.isMainAuthor ? 'bg-red-100 text-red-800 hover:bg-red-200' : 'text-slate-700 hover:bg-indigo-100')
        }`;
        
        // ★ 修正: isMainAuthor フラグを渡す必要がなくなった
        li.onclick = () => onSelect(author.id); 
        list.appendChild(li);
    });

    panel.appendChild(list);
}


/**
 * メイン関数 (旧 renderCoauthorTimeline)
 * コンテナを左右に分割し、ランキングとエゴネットワークを表示する
 * @param {d3.Selection} svg - d3.select("#coauthorNet") から渡されるSVG要素
 * @param {object} data - メインデータ
 * @param {object} state - グローバル状態
 * @param {object} callbacks - コールバック関数
 */
function renderCoauthorTimeline(svg, data, state, callbacks) {
    // ★ 修正: allPapers (data.nodes) は不要になった
    const { co_author_data, main_author_name } = data;
    
    // --- コンテナのセットアップ ---
    const container = svg.node().closest("#coauthor-container");
    if (!container) return;

    // コンテナをクリアし、flexレイアウトに変更
    container.innerHTML = '';
    container.className = 'flex w-full h-full border border-gray-200 rounded-b-md'; // index.htmlのレイアウトに合わせる

    let selectedAuthorId = null;
    let currentAnimationInterval = null; // ★ 実行中のインターバルを管理

    // --- 左パネル（ランキング）の作成 ---
    const leftPanel = document.createElement('div');
    leftPanel.className = 'w-1/3 h-full p-2 border-r overflow-y-auto bg-slate-50';
    container.appendChild(leftPanel);

    // --- 右パネル（SVGコンテナ）の作成 ---
    const rightPanel = document.createElement('div');
    rightPanel.className = 'w-2/3 h-full relative bg-white';
    container.appendChild(rightPanel);

    // d3から渡された<svg>要素を右パネルに移動し、サイズを調整
    svg.selectAll("*").remove(); // svgの中身をクリア
    svg.attr('width', '100%').attr('height', '100%');
    rightPanel.appendChild(svg.node()); // SVGを右パネルに追加

    // --- 選択コールバック ---
    const handleAuthorSelect = (authorId) => { 
        // ★ 実行中のアニメーションがあれば停止
        if (window.addNodeInterval) {
            window.addNodeInterval.stop();
        }

        if (selectedAuthorId === authorId) {
            selectedAuthorId = null; // 再クリックで選択解除
        } else {
            selectedAuthorId = authorId;
        }
        
        renderAuthorRankList(leftPanel, co_author_data, main_author_name, handleAuthorSelect, selectedAuthorId);
        
        // ★ 常に renderEgoNetwork を呼び出す
        // (renderEgoNetwork内でアニメーションインターバルがグローバルに設定される)
        renderEgoNetwork(svg, co_author_data, selectedAuthorId, main_author_name);
    };

    // --- 初期描画 ---
    renderAuthorRankList(leftPanel, co_author_data, main_author_name, handleAuthorSelect, selectedAuthorId);
    renderEgoNetwork(svg, co_author_data, selectedAuthorId, main_author_name); // 初期状態では何も選択されていない (null)
}