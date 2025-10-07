// Dendrogram Visualization
function renderDendrogram(svg, data, state, callbacks) {
    console.log("[DEBUG] renderDendrogram が開始されました。");
    const { dendrogram_data } = data;
    const { reclusterCallback } = callbacks; // 親から再クラスタリング用のコールバック関数を受け取る

    svg.selectAll("*").remove();

    if (!dendrogram_data) {
        svg.append("text")
            .attr("x", "50%")
            .attr("y", "50%")
            .attr("text-anchor", "middle")
            .text("デンドログラムデータがありません。");
        console.warn("[DEBUG] デンドログラムデータが見つかりませんでした。");
        return;
    }

    const container = svg.node().closest("#dendrogram-container");
    const { width: W, height: H } = container.getBoundingClientRect();

    console.log(`[DEBUG] デンドログラムコンテナのサイズ: Width=${W}, Height=${H}`);

    if (W === 0 || H === 0) {
        console.warn("[DEBUG] デンドログラムコンテナのサイズが0です。描画を中断します。(タブが非表示になっている可能性があります)");
        svg.append("text")
            .attr("x", "50%")
            .attr("y", "50%")
            .attr("text-anchor", "middle")
            .style("font-size", "10px")
            .text("タブを有効にすると表示されます。");
        return;
    }

    const MARGIN = { top: 5, right: 10, bottom: 5, left: 20 };

    // --- D3 Hierarchy and Layout ---
    const root = d3.hierarchy(dendrogram_data);
    console.log("[DEBUG] d3.hierarchy オブジェクト:", root);
    
    const clusterLayout = d3.cluster().size([H - MARGIN.top - MARGIN.bottom, W - MARGIN.left - MARGIN.right]);
    clusterLayout(root);
    
    let maxDistance = 0;
    root.each(d => {
        if (d.data.distance > maxDistance) {
            maxDistance = d.data.distance;
        }
    });
    const xScale = d3.scaleLinear().domain([0, maxDistance]).range([0, W - MARGIN.left - MARGIN.right]);
    
    root.each(d => {
        d.y = xScale(d.data.distance || 0);
    });

    const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    // --- Links (描画ロジックを修正) ---
    g.append("g")
        .selectAll('path')
        .data(root.links())
        .join('path')
        .attr('d', d => {
            // "elbow" path generator
            return `M${d.source.y},${d.source.x} C${(d.source.y + d.target.y) / 2},${d.source.x} ${(d.source.y + d.target.y) / 2},${d.target.x} ${d.target.y},${d.target.x}`;
        })
        .attr("fill", "none")
        .attr("stroke", "#555")
        .attr("stroke-width", 1);


    // --- Nodes ---
    g.append("g")
        .selectAll('g')
        .data(root.descendants())
        .join('g')
        .attr('transform', d => `translate(${d.y},${d.x})`)
        .append('circle')
        .attr('r', 2)
        .attr("fill", "#555");

    // --- Cutoff line and interaction ---
    const topicCountDisplayEl = document.getElementById('topicCountDisplay');
    const kInput = document.getElementById('k');

    const cutoffLine = g.append("line")
        .attr("stroke", "red")
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "4,4")
        .attr("y1", 0)
        .attr("y2", H - MARGIN.top - MARGIN.bottom);

    function getClusterCountForX(xPosition) {
        const boundedX = Math.max(0, Math.min(W - MARGIN.left - MARGIN.right, xPosition));
        const cutoffDistance = xScale.invert(boundedX);

        let clusterCount = 0;
        root.each(d => {
            const parentDistance = d.parent ? (d.parent.data.distance || 0) : Infinity;
            const currentDistance = d.data.distance || 0;
            if (currentDistance <= cutoffDistance && parentDistance > cutoffDistance) {
                clusterCount++;
            }
        });
        if (root.data.distance <= cutoffDistance && clusterCount === 0 && root.children) {
            clusterCount = 1;
        } else if (cutoffDistance === 0) {
            clusterCount = root.leaves().length;
        }
        return clusterCount;
    }

    function updateCutoff(xPosition) {
        const boundedX = Math.max(0, Math.min(W - MARGIN.left - MARGIN.right, xPosition));
        cutoffLine.attr("x1", boundedX).attr("x2", boundedX);
        const clusterCount = getClusterCountForX(xPosition);
        if (topicCountDisplayEl) {
            topicCountDisplayEl.textContent = clusterCount;
        }
        return clusterCount;
    }
    
    function setInitialCutoff(targetCount) {
        let bestX = W / 2;
        let bestCount = -1;
        let minDiff = Infinity;
        const searchWidth = W - MARGIN.left - MARGIN.right;

        for(let i = 0; i <= 200; i++) {
            const currentX = (searchWidth / 200) * i;
            const count = getClusterCountForX(currentX);
            const diff = Math.abs(count - targetCount);

            if (diff < minDiff) {
                minDiff = diff;
                bestX = currentX;
                bestCount = count;
            } else if (diff === minDiff) {
                if (count >= targetCount && (bestCount < targetCount || bestCount > count)) {
                    bestX = currentX;
                    bestCount = count;
                }
            }
        }
        const finalCount = updateCutoff(bestX);
        if (kInput) {
            kInput.value = finalCount;
        }
    }
    
    const initialK = kInput && kInput.value ? parseInt(kInput.value, 10) : 5;
    setInitialCutoff(initialK);

    const drag = d3.drag()
        .on("drag", function(event) {
            const count = updateCutoff(event.x);
            if (kInput) {
                kInput.value = count;
            }
        })
        .on("end", function(event) {
            if (reclusterCallback && kInput && parseInt(kInput.value, 10) > 1) {
                reclusterCallback();
            }
        });

    g.append("rect")
        .attr("width", W - MARGIN.left - MARGIN.right)
        .attr("height", H - MARGIN.top - MARGIN.bottom)
        .style("fill", "none")
        .style("pointer-events", "all")
        .style("cursor", "col-resize")
        .call(drag);
    
    console.log("[DEBUG] renderDendrogram が正常に完了しました。");
}
