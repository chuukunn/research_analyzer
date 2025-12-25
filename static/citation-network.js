// Citation Network Visualization (Time-series)
// Rebuilt to enforce year-based vertical constraints and allow horizontal freedom.

function renderCitationNetwork(svg, data, state, callbacks, verticalGap = 30, horizontalWidth = 800) {
    const { selectionState, color } = state;
    const { onNodeClick } = callbacks;

    // Validate inputs
    verticalGap = +verticalGap || 30;
    horizontalWidth = +horizontalWidth || 800;

    console.log(`[CitationNet] Rendering with Gap=${verticalGap}, Width=${horizontalWidth}`);

    // --- 1. Setup & Data Filtering ---
    const MARGIN = 60;

    // Clear previous SVG content
    svg.selectAll("*").remove();
    const gMain = svg.append("g");

    // Filter by Topic
    // If no topic is selected, show all. Otherwise, only show papers in selected topics.
    let topicNodeIds = null;
    if (selectionState.topics.size > 0) {
        topicNodeIds = new Set(data.nodes.filter(n => selectionState.topics.has(n.topic)).map(n => n.paper_id));
    } else {
        topicNodeIds = new Set(data.nodes.map(n => n.paper_id));
    }

    if (topicNodeIds.size === 0) {
        svg.append("text")
            .attr("x", "50%")
            .attr("y", "50%")
            .attr("text-anchor", "middle")
            .attr("fill", "#666")
            .text("表示対象の論文がありません。");
        return;
    }

    const nodes = data.nodes.filter(n => topicNodeIds.has(n.paper_id));
    // Links: Only keep links where both source and target are in the filtered nodes (Local Citation)
    const links = data.edges.filter(e => topicNodeIds.has(e.source) && topicNodeIds.has(e.target));

    // --- 2. Year Layout Calculation ---
    // Extract valid years (exclude 0 or null)
    const rawYears = nodes.map(d => d.year).filter(y => y && y > 0);
    if (rawYears.length === 0) return; // No valid data

    const minYear = Math.min(...rawYears);
    const maxYear = Math.max(...rawYears);

    // Create a continuous array of years
    const years = [];
    for (let y = minYear; y <= maxYear; y++) {
        years.push(y);
    }

    // Helper: Y position for a given year
    // Top = Oldest `minYear` -> Bottom = Newest `maxYear`
    const getY = (year) => MARGIN + (year - minYear) * verticalGap;

    // --- 3. Dimension & SVG Sizing ---
    const totalContentHeight = (years.length - 1) * verticalGap + MARGIN * 2;
    // Ensure height is at least enough to hold content
    const svgHeight = Math.max(totalContentHeight, 600);
    const svgWidth = horizontalWidth + MARGIN * 2;

    // Resize SVG to allow scrolling in container
    svg.attr("width", svgWidth)
        .attr("height", svgHeight);

    // --- 4. Simulation Preparation ---
    // Clone data for simulation to avoid mutating original source
    const simNodes = nodes.map(n => ({
        ...n,
        id: n.paper_id,
        // Initial constraints
        // Initialize x to center + jitter to avoid "flying in" or bias
        x: MARGIN + horizontalWidth / 2 + (Math.random() - 0.5) * 50,
        fx: null, // Free to move horizontally (initially)
        fy: getY(n.year), // Fixed vertically to its year line
        r: 4 + Math.log1p(n.cit_cnt || 0) * 1.5 // Node size based on citations
    }));

    const nodeMap = new Map(simNodes.map(n => [n.id, n]));

    const simLinks = links.map(l => ({
        source: nodeMap.get(l.source),
        target: nodeMap.get(l.target),
        id: `${l.source}-${l.target}`
    })).filter(l => l.source && l.target);

    // --- 5. Force Simulation ---
    const sim = d3.forceSimulation(simNodes)
        // Link Force: Pull connected nodes together
        .force("link", d3.forceLink(simLinks)
            .id(d => d.id)
            .strength(0.3) // Moderate strength
            .distance(verticalGap * 0.8) // Ideally, connected nodes are often 1 year apart
        )
        // Charge/ManyBody: Repulsion prevents overlap
        .force("charge", d3.forceManyBody().strength(-300))
        // Collision: Prevent physical overlap
        .force("collide", d3.forceCollide().radius(d => d.r + 2).iterations(2))
        // X-Force: Keep nodes centered horizontally within the bounds
        .force("center_x", d3.forceX(MARGIN + horizontalWidth / 2).strength(0.15));

    // Save simulation to SVG for cleanup later if needed
    svg.property("simulation", sim);

    // --- 6. Rendering ---

    // (A) Year Lines (Grid)
    const yearGroup = gMain.append("g").attr("class", "year-lines");

    // Line per year
    yearGroup.selectAll("line")
        .data(years)
        .enter()
        .append("line")
        .attr("x1", MARGIN)
        .attr("x2", MARGIN + horizontalWidth)
        .attr("y1", d => getY(d))
        .attr("y2", d => getY(d))
        .attr("stroke", "#e2e8f0")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,2");

    // Text label per year
    yearGroup.selectAll("text")
        .data(years)
        .enter()
        .append("text")
        .attr("x", MARGIN - 10)
        .attr("y", d => getY(d))
        .attr("dy", "0.32em")
        .attr("text-anchor", "end")
        .attr("font-size", "12px")
        .attr("fill", "#64748b")
        .text(d => d);

    // (B) Arrow Marker for links
    svg.append("defs").append("marker")
        .attr("id", "arrowhead")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 10) // Position relative to end of line
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", "#94a3b8");

    // (C) Links
    const linkSelection = gMain.append("g")
        .attr("class", "links")
        .selectAll("line")
        .data(simLinks)
        .enter()
        .append("line")
        .attr("stroke", "#94a3b8")
        .attr("stroke-opacity", 0.6)
        .attr("stroke-width", 1)
        .attr("marker-end", "url(#arrowhead)"); // Add arrow

    // (D) Nodes
    const nodeSelection = gMain.append("g")
        .attr("class", "nodes")
        .selectAll("g")
        .data(simNodes)
        .enter()
        .append("g")
        .attr("class", "node")
        .call(d3.drag()
            .on("start", dragStarted)
            .on("drag", dragged)
            .on("end", dragEnded)
        )
        .on("click", (e, d) => {
            e.stopPropagation();
            onNodeClick(d);
        });

    // Node Circle
    nodeSelection.append("circle")
        .attr("r", d => d.r)
        .attr("fill", d => color(d.topic))
        .attr("cursor", "pointer")
        .attr("stroke", "#fff")
        .attr("stroke-width", 2);

    // Node Label (Title + Citations) - appearing on hover could be better, but native title is simple
    nodeSelection.append("title")
        .text(d => `[${d.year}] ${d.title}\nCitations: ${d.cit_cnt}\nTopic: ${d.topic}`);

    // Initial styling update
    updateNodeStyles(svg, state);

    // --- 7. Tick Function ---
    sim.on("tick", () => {
        // Constrain X within horizontalWidth
        simNodes.forEach(d => {
            // Keep y fixed (redundant but safe)
            d.y = d.fy;
            // Clamp x
            d.x = Math.max(MARGIN + d.r, Math.min(MARGIN + horizontalWidth - d.r, d.x));
        });

        linkSelection
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x) // Should adjust for radius if we want arrow exactly at edge
            .attr("y2", d => d.target.y);

        nodeSelection.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    // --- Drag Behaviors (X-Axis Only) ---
    function dragStarted(event, d) {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x; // Lock x
        // d.fy is already fixed by year layout
    }

    function dragged(event, d) {
        // Allow moving x, but keep y constrained
        d.fx = event.x;
    }

    function dragEnded(event, d) {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null; // Unlock x so simulation can settle
        // d.fy remains fixed
    }

    // Zoom support
    const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => {
            gMain.attr("transform", event.transform);
        });
    svg.call(zoom);
}

// Optimized Style Update Function
// Called when selection changes, avoiding full re-simulation.
function updateNodeStyles(svg, state) {
    const { selectionState } = state;

    // Update Node Strokes
    svg.selectAll(".node circle")
        .transition().duration(200)
        .attr("stroke", d => selectionState.papers.has(d.paper_id) ? "#000" : "#fff")
        .attr("stroke-width", d => selectionState.papers.has(d.paper_id) ? 3 : 1.5)
        .attr("fill-opacity", d => {
            // If any node is selected, dim others? (Optional, currently just keeping solid)
            // Example: if (selectionState.papers.size > 0 && !selectionState.papers.has(d.paper_id)) return 0.5;
            return 1;
        });
}
