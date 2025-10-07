// Citation Network Visualization (Time-series)
function renderCitationNetwork(svg, data, state, callbacks) {
    const { selectionState, color } = state;
    const { onNodeClick } = callbacks;

    const MARGIN = 60;
    svg.selectAll("*").remove();
    const gMain = svg.append("g");

    // --- Check Selection ---
    if (selectionState.topics.size !== 1) {
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
    })).filter(l => l.source && l.target); // Ensure links are valid


    const container = svg.node().closest("#citation-container");
    const { width: W, height: H } = container.getBoundingClientRect();

    // --- Year Axis ---
    const years = [...new Set(nodes.map(d => d.year))].sort((a,b) => a - b);
    if (years.length === 0) return;
    
    const yBand = d3.scaleBand()
        .domain(years)
        .range([MARGIN, H - MARGIN])
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
        .attr("marker-mid", "url(#mArr)") // 矢印を中央に配置
        .attr("stroke", "#555").attr("stroke-width", 1);
        
    const node = gMain.selectAll(".node").data(simNodes).enter().append("g")
        .attr("class", "node")
        .call(drag(sim))
        .on("click", (e, d) => {
            e.stopPropagation();
            onNodeClick(d);
        });

    node.append("circle")
        .attr("r", d => d.r)
        .attr("fill", d => color(d.topic))
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

/* ========= 共通ユーティリティ ========= */
// Y軸方向の移動を制限するよう修正
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
