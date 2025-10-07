// UMAP Network Visualization
function renderUmapNetwork(svg, data, state, callbacks) {
    const { nodes, edges } = data;
    const { selectionState, color } = state;
    const { onNodeClick, onBackgroundClick } = callbacks;

    // --- レイアウト調整 ---
    // 凡例コンテナが長くなったときに、この可視化コンテナ全体が
    // 親要素からはみ出さないようにflexboxの挙動を調整します。
    const parentFlexContainer = svg.node().closest('.w-3\\/4.flex');
    if (parentFlexContainer) {
        parentFlexContainer.style.minWidth = '0';
    }
    // --------------------

    const MARGIN = { top: 20, right: 20, bottom: 30, left: 40 };

    svg.selectAll("*").remove();
    const gMain = svg.append("g");

    let allPlottableNodes = nodes.filter(d => d.embedding_2d && d.embedding_2d.length === 2);
    if (allPlottableNodes.length === 0) {
        gMain.append("text").attr("x", "50%").attr("y", "50%").attr("text-anchor", "middle").text("表示可能な論文がありません。");
        return;
    }

    allPlottableNodes.sort((a, b) => a.year - b.year);

    // FIX: Correctly select the container for width/height calculation.
    const container = svg.node().closest("#svg-container");
    if (!container) {
        console.error("#svg-container not found");
        return;
    }
    const { width: W, height: H } = container.getBoundingClientRect();
    if (W === 0 || H === 0) return;

    const yearExtent = d3.extent(allPlottableNodes, d => d.year);
    const saturationScale = d3.scaleLinear().domain(yearExtent).range([0.4, 1.0]);

    const xScale = d3.scaleLinear().domain(d3.extent(allPlottableNodes, d => d.embedding_2d[0])).range([MARGIN.left, W - MARGIN.right]);
    const yScale = d3.scaleLinear().domain(d3.extent(allPlottableNodes, d => d.embedding_2d[1])).range([H - MARGIN.bottom, MARGIN.top]);

    const nodeMap = new Map(allPlottableNodes.map(node => [node.paper_id, node]));
    
    // --- Edge Filtering Logic ---
    let linksToRender = [];
    const hasSelection = selectionState.papers.size > 0 || selectionState.topics.size > 0;

    if (hasSelection) {
        const selectedPaperIds = new Set(selectionState.papers);
        if (selectionState.topics.size > 0) {
            nodes.forEach(node => {
                if (selectionState.topics.has(node.topic)) {
                    selectedPaperIds.add(node.paper_id);
                }
            });
        }
        
        linksToRender = edges.filter(d =>
            nodeMap.has(d.source) && nodeMap.has(d.target) &&
            (selectedPaperIds.has(d.source) || selectedPaperIds.has(d.target))
        );
    }
    // If no selection, linksToRender remains empty.

    gMain.append("g").selectAll("line").data(linksToRender).join("line")
        .attr("class", "link")
        .attr("x1", d => xScale(nodeMap.get(d.source).embedding_2d[0]))
        .attr("y1", d => yScale(nodeMap.get(d.source).embedding_2d[1]))
        .attr("x2", d => xScale(nodeMap.get(d.target).embedding_2d[0]))
        .attr("y2", d => yScale(nodeMap.get(d.target).embedding_2d[1]))
        .attr("stroke-opacity", 0.6);

    // --- Node Rendering ---
    const isSelected = (d) => {
        const noSelection = selectionState.topics.size === 0 && selectionState.papers.size === 0 && selectionState.authors.size === 0;
        if (noSelection) return true;

        const topicMatch = selectionState.topics.has(d.topic);
        const paperMatch = selectionState.papers.has(d.paper_id);
        const authorMatch = d.authors && d.authors.some(author => selectionState.authors.has(author));
        
        return topicMatch || paperMatch || authorMatch;
    };

    const nodeGroup = gMain.append("g");
    const node = nodeGroup.selectAll(".node").data(allPlottableNodes, d => d.paper_id).join("g")
        .attr("class", "node")
        .attr("transform", d => `translate(${xScale(d.embedding_2d[0])}, ${yScale(d.embedding_2d[1])})`)
        .on("click", (event, d) => {
            event.stopPropagation();
            onNodeClick(d);
        });

    node.append("circle")
        .attr("r", d => 3 + Math.log1p(d.cit_cnt) * 1.5)
        .attr("fill", d => {
            if (d.topic === -1) return "#cccccc";
            const baseColor = d3.hsl(color(d.topic));
            baseColor.s = saturationScale(d.year);
            return baseColor;
        })
        .attr("stroke", d => selectionState.papers.has(d.paper_id) ? "#000" : "#fff")
        .attr("stroke-width", d => selectionState.papers.has(d.paper_id) ? 2.5 : 1.5);

    node.append("title").text(d => `[${d.year}] ${d.title}`);
    nodeGroup.selectAll(".node").style("opacity", d => isSelected(d) ? 1.0 : 0.1);

    const zoomBehavior = d3.zoom().scaleExtent([0.5, 10]).on("zoom", (event) => gMain.attr("transform", event.transform));
    svg.call(zoomBehavior).on("dblclick.zoom", null);
    svg.on("click", onBackgroundClick);
}
