// Co-author Network Visualization -> Timeline Visualization
function renderCoauthorTimeline(svg, data, state, callbacks) {
    svg.selectAll("*").remove();
    const { timeline_data, nodes: papers, co_author_data, institution_data } = data;
    const { onGroupClick, onInstitutionGroupClick } = callbacks;

    if (!timeline_data || timeline_data.length === 0) {
        svg.append("text")
            .attr("x", "50%")
            .attr("y", "50%")
            .attr("text-anchor", "middle")
            .text("タイムラインデータがありません。");
        return;
    }

    const container = svg.node().closest("#coauthor-container");
    const { width: W, height: H } = container.getBoundingClientRect();
    if (W <= 0 || H <= 0) return;

    const MARGIN = { top: 20, right: 20, bottom: 40, left: 200 };

    // --- Group data by category ---
    const dataByCategory = d3.group(timeline_data, d => d.category);
    const categories = ["Research Group", "Institution", "Journal"]; // Define order
    
    let y_items = [];
    categories.forEach(cat => {
        const items = dataByCategory.get(cat) || [];
        if (items.length > 0) {
            y_items.push({name: cat, isHeader: true}); // Add header only if items exist
            items.forEach(item => y_items.push(item));
        }
    });

    // --- Scales ---
    const allYears = papers.map(p => p.year).filter(y => y > 0);
    if (allYears.length === 0) return;
    const yearExtent = d3.extent(allYears);
    
    const xScale = d3.scaleLinear()
        .domain(yearExtent)
        .range([MARGIN.left, W - MARGIN.right]);

    const yScale = d3.scaleBand()
        .domain(y_items.map(d => d.name))
        .range([MARGIN.top, H - MARGIN.bottom])
        .padding(0.2);
    
    // --- Axes ---
    const xAxis = d3.axisBottom(xScale).tickFormat(d3.format("d"));
    const yAxis = d3.axisLeft(yScale).tickSize(0);

    const xAxisGroup = svg.append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0, ${H - MARGIN.bottom})`)
        .call(xAxis);

    const yAxisGroup = svg.append("g")
        .attr("class", "y-axis")
        .attr("transform", `translate(${MARGIN.left}, 0)`)
        .call(yAxis);
    
    yAxisGroup.selectAll(".tick text")
      .text(d => {
          const item = y_items.find(it => it.name === d);
          if (item && item.isHeader) return d;
          return d.length > 30 ? d.substring(0, 27) + "..." : d;
      })
      .filter(d => y_items.find(it => it.name === d && it.isHeader))
      .style("font-weight", "bold")
      .style("font-size", "14px")
      .attr("fill", "#333")
      .attr("dx", -5);

    yAxisGroup.selectAll(".domain").remove();

    // --- Render Bars ---
    // Add a clipping path so bars don't draw over the Y-axis labels when zoomed.
    svg.append("defs").append("clipPath")
        .attr("id", "timeline-clip")
      .append("rect")
        .attr("x", MARGIN.left)
        .attr("y", 0)
        .attr("width", W - MARGIN.left)
        .attr("height", H);

    const gBars = svg.append("g")
        .attr("clip-path", "url(#timeline-clip)");

    const bars = gBars.selectAll(".timeline-bar")
        .data(y_items.filter(d => !d.isHeader))
        .enter()
        .append("rect")
        .attr("class", "timeline-bar")
        .attr("x", d => xScale(d.start_year))
        .attr("y", d => yScale(d.name))
        .attr("width", d => Math.max(2, xScale(d.end_year) - xScale(d.start_year)))
        .attr("height", yScale.bandwidth())
        .attr("rx", 3)
        .attr("ry", 3)
        .style("fill", d => {
            if (d.category === "Research Group") return "#1f77b4";
            if (d.category === "Institution") return "#ff7f0e";
            if (d.category === "Journal") return "#2ca02c";
            return "#ccc";
        })
        .style("opacity", 0.7)
        .style("cursor", "pointer")
        .on("mouseover", function() { d3.select(this).style("opacity", 1); })
        .on("mouseout", function() { d3.select(this).style("opacity", 0.7); })
        .on("click", (event, d) => {
            if (d.category === "Research Group" && onGroupClick) {
                const clusterId = parseInt(d.name.replace("Group ", ""), 10);
                if (!isNaN(clusterId) && co_author_data) {
                    const members = co_author_data.nodes.filter(n => n.cluster === clusterId);
                    onGroupClick(d.name, members);
                }
            } else if (d.category === "Institution" && onInstitutionGroupClick) {
                const clusterId = parseInt(d.name.replace("Institution Group ", ""), 10);
                if (!isNaN(clusterId) && institution_data) {
                    const members = institution_data.nodes.filter(n => n.cluster === clusterId);
                    onInstitutionGroupClick(d.name, members);
                }
            }
        });

    bars.append("title")
        .text(d => `${d.name}\nCategory: ${d.category}\nPeriod: ${d.start_year} - ${d.end_year}`);
        
    // --- Zoom and Pan ---
    const zoom = d3.zoom()
        .scaleExtent([0.5, 20]) 
        .translateExtent([[0, 0], [W, H]]) 
        .on("zoom", (event) => {
            const transform = event.transform;

            // Update X axis and bars' horizontal properties
            const newXScale = transform.rescaleX(xScale);
            xAxisGroup.call(xAxis.scale(newXScale));
            bars.attr('x', d => newXScale(d.start_year))
                .attr('width', d => Math.max(2, newXScale(d.end_year) - newXScale(d.start_year)));

            // Update Y axis and bars' vertical properties
            const newYScale = transform.rescaleY(yScale);
            yAxisGroup.call(yAxis.scale(newYScale));
            bars.attr('y', d => newYScale(d.name))
                .attr('height', newYScale.bandwidth());
        });

    svg.call(zoom);
}
