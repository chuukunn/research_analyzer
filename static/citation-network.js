// Citation Network Visualization (Time-series)

// ★ 状態保持用の変数をクロージャ外（または要素に紐づけ）で管理
// SVG要素自体に前のトピックIDをデータとして持たせることで再利用を判定する
function renderCitationNetwork(svg, data, state, callbacks) {
    const { selectionState, color } = state;
    const { onNodeClick } = callbacks;

    const MARGIN = 60;
    
    // --- Check Selection ---
    if (selectionState.topics.size !== 1) {
        svg.selectAll("*").remove(); // 選択解除時はクリア
        svg.property("currentTopicId", null); // 状態クリア

        const message = selectionState.topics.size > 1 
            ? "複数のトピックが選択されています。1つに絞ってください。"
            : "引用ネットワークを表示するには、まずトピックを1つ選択してください。";
        
        svg.append("text")
            .attr("x", "50%")
            .attr("y", "50%")
            .attr("text-anchor", "middle")
            .style("font-size", "14px")
            .text(message);
        return;
    }

    const selectedTopicId = [...selectionState.topics][0];
    const prevTopicId = svg.property("currentTopicId");

    // ★ 修正点: トピックが変わっていない場合は、スタイル更新のみ行う (Update Pattern)
    if (prevTopicId === selectedTopicId) {
        updateNodeStyles(svg, state);
        return; // 再シミュレーションしない
    }

    // トピックが変わったのでフルリフレッシュ
    svg.selectAll("*").remove();
    svg.property("currentTopicId", selectedTopicId); // 新しいトピックIDを保存
    const gMain = svg.append("g");


    // --- Filter Data for the Selected Topic ---
    const topicNodeIds = new Set(data.nodes.filter(n => n.topic === selectedTopicId).map(n => n.paper_id));
    if (topicNodeIds.size === 0) {
        svg.append("text").attr("x", "50%").attr("y", "50%").attr("text-anchor", "middle").text("このトピックには論文がありません。");
        return;
    }
    
    const nodes = data.nodes.filter(n => topicNodeIds.has(n.paper_id));
    const links = data.edges.filter(e => topicNodeIds.has(e.source) && topicNodeIds.has(e.target));
    
    // Create copies to avoid modifying original data
    const simNodes = nodes.map(n => ({...n, id: n.paper_id}));
    const nodeMap = new Map(simNodes.map(n => [n.id, n]));
    const simLinks = links.map(l => ({
        source: nodeMap.get(l.source),
        target: nodeMap.get(l.target)
    })).filter(l => l.source && l.target);


    const container = svg.node().closest("#citation-container");
    const { width: W, height: H } = container.getBoundingClientRect();

    // --- Year Axis ---
    const years = [...new Set(nodes.map(d => d.year))].sort((a,b) => a - b);
    if (years.length === 0) return;
    
    // Y軸の描画範囲（range）を3倍に
    const effectiveHeight = H > MARGIN * 2 ? H - MARGIN * 2 : 1;
    const rangeHeight = effectiveHeight * 3;

    const yBand = d3.scaleBand()
        .domain(years)
        .range([MARGIN, MARGIN + rangeHeight])
        .paddingInner(0.5);

    const yPos = y => yBand(y) + yBand.bandwidth() / 2;

    gMain.append("g").selectAll("line").data(years).enter()
        .append("line").attr("x1", MARGIN).attr("x2", W - MARGIN)
        .attr("y1", yPos).attr("y2", yPos).attr("stroke", "#eee");
    gMain.append("g").selectAll("text").data(years).enter()
        .append("text").attr("x", MARGIN - 8).attr("y", d => yPos(d) + 4)
        .attr("text-anchor", "end").attr("font-size", "10px").text(d => d);

    // --- Simulation Setup ---
    simNodes.forEach(d => {
        d.r = 4 + Math.log1p(d.cit_cnt);
        d.fy = yPos(d.year);
    });

    const sim = d3.forceSimulation(simNodes)
        .force("link", d3.forceLink(simLinks).id(d => d.id).distance(80).strength(0.5))
        .force("charge", d3.forceManyBody().strength(-80))
        .force("collision", d3.forceCollide().radius(d => d.r + 2))
        .force("x", d3.forceX(W / 2).strength(0.1));
    
    // シミュレーションインスタンスをSVGに保存して、後で停止できるようにする（必要であれば）
    svg.property("simulation", sim);

    // --- Arrow Marker ---
    svg.append("defs").append("marker")
        .attr("id", "mArr")
        .attr("viewBox", "0 -6 12 12")
        .attr("markerWidth", 6).attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path").attr("d", "M0,-6L12,0L0,6").attr("fill", "#555");

    // --- Render Elements ---
    const link = gMain.selectAll(".link").data(simLinks).enter().append("line")
        .attr("class", "link")
        .attr("marker-mid", "url(#mArr)")
        .attr("stroke", "#555").attr("stroke-width", 1);
        
    const node = gMain.selectAll(".node").data(simNodes).enter().append("g")
        .attr("class", "node")
        .call(drag(sim))
        .on("click", (e, d) => {
            e.stopPropagation();
            onNodeClick(d); // ここで親のstateが更新され、rerenderAll -> renderCitationNetworkが再度呼ばれる
        });

    node.append("circle")
        .attr("r", d => d.r)
        .attr("fill", d => color(d.topic))
        // 初回描画時のスタイル設定
        .attr("stroke", d => state.selectionState.papers.has(d.paper_id) ? "#000" : "#fff")
        .attr("stroke-width", d => state.selectionState.papers.has(d.paper_id) ? 2 : 1);

    node.append("title").text(d => `[${d.year}] ${d.title}\nCitations: ${d.cit_cnt}`);

    // --- Tick Function ---
    sim.on("tick", () => {
        simNodes.forEach(d => d.x = Math.max(MARGIN + d.r, Math.min(W - MARGIN - d.r, d.x)));
        link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    zoom(svg, gMain);
}

// ★ 追加: スタイル更新のみを行う関数
function updateNodeStyles(svg, state) {
    const node = svg.selectAll(".node circle");
    // トランジションをつけて滑らかに変化させる
    node.transition().duration(200)
        .attr("stroke", d => state.selectionState.papers.has(d.paper_id) ? "#000" : "#fff")
        .attr("stroke-width", d => state.selectionState.papers.has(d.paper_id) ? 2 : 1);
}

/* ========= 共通ユーティリティ ========= */
function drag(sim) {
    function dragstarted(event, d) {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
    }
    function dragged(event, d) {
        d.fx = event.x; // X座標のみ更新
    }
    function dragended(event, d) {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
    }
    return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
}

function zoom(svg, group) {
    svg.call(d3.zoom()
        .scaleExtent([0.2, 10])
        .on("zoom", e => group.attr("transform", e.transform)));
}