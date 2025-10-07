// temporal-keyword.js

let temporalChartType = 'stream'; // 'stream' or 'bar'

function showKeywordDetailsModal(topic) {
    const modal = document.getElementById('keyword-modal');
    const titleEl = document.getElementById('modal-title');
    const contentEl = document.getElementById('modal-content');
    const closeBtn = document.getElementById('modal-close-btn');

    if (!modal || !titleEl || !contentEl || !closeBtn) {
        console.error('Modal elements not found!');
        return;
    }

    titleEl.textContent = `トピック ${topic.Topic} - キーワード詳細`;
    
    contentEl.innerHTML = ''; // Clear previous content

    if (!topic.AllKeywords || topic.AllKeywords.length === 0) {
        contentEl.innerHTML = '<p>詳細なキーワードデータがありません。</p>';
    } else {
        const table = document.createElement('table');
        table.className = 'w-full text-sm text-left';
        table.innerHTML = `
            <thead class="text-xs text-slate-700 uppercase bg-slate-50">
                <tr>
                    <th scope="col" class="px-4 py-2">キーワード</th>
                    <th scope="col" class="px-4 py-2 text-right">c-TF-IDFスコア</th>
                </tr>
            </thead>
        `;
        const tbody = document.createElement('tbody');
        topic.AllKeywords.forEach(kw => {
            const row = tbody.insertRow();
            row.className = 'bg-white border-b';
            const cell1 = row.insertCell();
            cell1.className = 'px-4 py-2 font-medium text-slate-900 whitespace-nowrap';
            cell1.textContent = kw.word;
            const cell2 = row.insertCell();
            cell2.className = 'px-4 py-2 text-right';
            cell2.textContent = kw.score.toFixed(4);
        });
        table.appendChild(tbody);
        contentEl.appendChild(table);
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const closeModal = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    };

    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeModal();
        }
    };
}


function renderTemporalKeyword(container, data, state, callbacks) {
    container.innerHTML = '';
    container.style.flexDirection = 'row';

    const leftPanel = document.createElement('div');
    leftPanel.className = 'w-2/3 h-full p-2 border-r flex flex-col';

    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'flex-shrink-0 mb-2 flex items-center justify-end space-x-2';
    leftPanel.appendChild(controlsContainer);

    const streamBtn = document.createElement('button');
    streamBtn.textContent = 'Streamgraph';
    streamBtn.className = `text-xs px-2 py-1 rounded-md ${temporalChartType === 'stream' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'}`;
    streamBtn.onclick = () => {
        if (temporalChartType !== 'stream') {
            temporalChartType = 'stream';
            renderTemporalKeyword(container, data, state, callbacks);
        }
    };
    controlsContainer.appendChild(streamBtn);

    const barBtn = document.createElement('button');
    barBtn.textContent = 'Bar Chart';
    barBtn.className = `text-xs px-2 py-1 rounded-md ${temporalChartType === 'bar' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'}`;
    barBtn.onclick = () => {
        if (temporalChartType !== 'bar') {
            temporalChartType = 'bar';
            renderTemporalKeyword(container, data, state, callbacks);
        }
    };
    controlsContainer.appendChild(barBtn);

    const chartContainer = document.createElement('div');
    chartContainer.className = 'flex-grow relative min-h-0';
    const svgChart = d3.create("svg").attr("width", "100%").attr("height", "100%");
    chartContainer.appendChild(svgChart.node());
    leftPanel.appendChild(chartContainer);

    const keywordLegendContainer = document.createElement('div');
    keywordLegendContainer.id = 'keyword-legend-container';
    keywordLegendContainer.className = 'w-1/3 h-full p-3 overflow-y-auto';
    
    container.append(leftPanel);
    container.append(keywordLegendContainer);

    if (temporalChartType === 'stream') {
        renderStreamgraph(svgChart, data, state, callbacks);
    } else {
        renderBarChart(svgChart, data, state, callbacks);
    }
    
    renderKeywordLegend(keywordLegendContainer, data, state, callbacks);
}


function renderStreamgraph(svg, data, state, callbacks) {
    const { nodes, topic_info } = data;
    const { selectionState, color } = state;
    const { onTopicClick, onBackgroundClick } = callbacks;

    const MARGIN = { top: 20, right: 30, bottom: 40, left: 50 };
    svg.selectAll("*").remove();

    const plottableNodes = nodes.filter(n => n.year > 0 && n.topic !== -1);
    if (plottableNodes.length < 2) {
        svg.append("text").attr("x", "50%").attr("y", "50%").attr("text-anchor", "middle").text("データが不足しています。");
        return;
    }

    const container = svg.node().parentElement;
    const { width: W, height: H } = container.getBoundingClientRect();
    if (W <= 0 || H <= 0) return;

    const countsByYearTopic = d3.rollup(plottableNodes, v => v.length, d => d.year, d => d.topic);
    const topicIds = topic_info.map(t => t.Topic).filter(id => id !== -1);
    const dataForStream = Array.from(countsByYearTopic.entries()).map(([year, topics]) => ({ year, ...Object.fromEntries(topicIds.map(id => [id, topics.get(id) || 0])) })).sort((a, b) => a.year - b.year);

    if (dataForStream.length < 2) {
        svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle").text("表示期間のデータが不足しています。");
        return;
    }

    const series = d3.stack()
        .keys(topicIds)
        .order(d3.stackOrderInsideOut)
        .offset(d3.stackOffsetNone) // Changed from d3.stackOffsetWiggle
        (dataForStream);
        
    const xScale = d3.scaleLinear()
        .domain(d3.extent(dataForStream, d => d.year))
        .range([MARGIN.left, W - MARGIN.right]);
        
    const yScale = d3.scaleLinear()
        .domain([0, d3.max(series, d => d3.max(d, d => d[1]))]).nice() // Set domain from 0 to max
        .range([H - MARGIN.bottom, MARGIN.top]);
        
    const area = d3.area()
        .x(d => xScale(d.data.year))
        .y0(d => yScale(d[0]))
        .y1(d => yScale(d[1]))
        .curve(d3.curveBasis);

    const g = svg.append("g");
    g.selectAll("path").data(series).join("path")
        .attr("d", area)
        .attr("fill", ({ key }) => color(key))
        .attr("opacity", ({ key }) => (selectionState.topics.size === 0 || selectionState.topics.has(key)) ? 1 : 0.2)
        .style("cursor", "pointer")
        .on("click", (event, d) => { event.stopPropagation(); onTopicClick(d.key); })
        .append("title").text(({key}) => topic_info.find(t => t.Topic === key)?.Keywords || `Topic ${key}`);
        
    svg.on("click", onBackgroundClick);

    svg.append("g").attr("transform", `translate(0, ${H - MARGIN.bottom})`).call(d3.axisBottom(xScale).tickFormat(d3.format("d")));
    svg.append("g").attr("transform", `translate(${MARGIN.left}, 0)`).call(d3.axisLeft(yScale).ticks(5));
}


function renderBarChart(svg, data, state, callbacks) {
    const { nodes, topic_info } = data;
    const { selectionState, color } = state;
    const { onTopicClick, onBackgroundClick } = callbacks;

    const MARGIN = { top: 20, right: 30, bottom: 50, left: 50 };
    svg.selectAll("*").remove();

    const plottableNodes = nodes.filter(n => n.year > 0 && n.topic !== -1);
    if (plottableNodes.length === 0) {
        svg.append("text").attr("x", "50%").attr("y", "50%").attr("text-anchor", "middle").text("データが不足しています。");
        return;
    }

    const container = svg.node().parentElement;
    const { width: W, height: H } = container.getBoundingClientRect();
    if (W <= 0 || H <= 0) return;

    const countsByYearTopic = d3.rollup(plottableNodes, v => v.length, d => d.year, d => d.topic);
    const topicIds = topic_info.map(t => t.Topic).filter(id => id !== -1);
    const dataForStack = Array.from(countsByYearTopic.entries()).map(([year, topics]) => ({ year, ...Object.fromEntries(topicIds.map(id => [id, topics.get(id) || 0])) })).sort((a, b) => a.year - b.year);
    
    if (dataForStack.length === 0) return;

    const series = d3.stack().keys(topicIds)(dataForStack);
    const years = dataForStack.map(d => d.year);
    const xScale = d3.scaleBand().domain(years).range([MARGIN.left, W - MARGIN.right]).padding(0.2);
    const yScale = d3.scaleLinear().domain([0, d3.max(series, d => d3.max(d, d => d[1]))]).nice().range([H - MARGIN.bottom, MARGIN.top]);

    const g = svg.append("g");
    g.selectAll("g").data(series).join("g")
        .attr("fill", d => color(d.key))
        .attr("opacity", ({ key }) => (selectionState.topics.size === 0 || selectionState.topics.has(key)) ? 1 : 0.2)
        .selectAll("rect").data(d => d).join("rect")
            .attr("x", d => xScale(d.data.year))
            .attr("y", d => yScale(d[1]))
            .attr("height", d => yScale(d[0]) - yScale(d[1]))
            .attr("width", xScale.bandwidth())
            .style("cursor", "pointer")
            .on("click", (event, d) => {
                const topicKey = series.find(s => s.includes(d)).key;
                event.stopPropagation();
                onTopicClick(topicKey);
            })
            .append("title").text(d => {
                const topicKey = series.find(s => s.includes(d)).key;
                const topic = topic_info.find(t => t.Topic === topicKey);
                return `${topic ? topic.Keywords : `Topic ${topicKey}`}\nYear: ${d.data.year}\nCount: ${d[1] - d[0]}`;
            });

    svg.on("click", onBackgroundClick);
    const xAxis = g.append("g").attr("transform", `translate(0,${H - MARGIN.bottom})`).call(d3.axisBottom(xScale).tickValues(xScale.domain().filter((d,i) => !(i%Math.ceil(years.length/10)) || i === years.length - 1)));
    xAxis.selectAll("text").attr("transform", "rotate(-45)").style("text-anchor", "end");
    g.append("g").attr("transform", `translate(${MARGIN.left},0)`).call(d3.axisLeft(yScale));
}


function renderKeywordLegend(container, data, state, callbacks) {
    const { topic_info } = data;
    const { selectionState, color } = state;
    const { onTopicClick } = callbacks;

    container.innerHTML = `<h3 class="font-semibold text-lg mb-2">トピックキーワード (BERTopic)</h3>`;
    const legendList = document.createElement('div');
    container.appendChild(legendList);

    const topics = topic_info.filter(t => t.Topic !== -1);
    if (topics.length === 0) {
        legendList.innerHTML = '<p class="text-slate-500">表示するトピックがありません。</p>';
        return;
    }

    topics.forEach(topic => {
        const item = document.createElement('div');
        item.className = 'topic-legend-item p-2 mb-2 border rounded-md cursor-pointer transition-all duration-200';
        item.dataset.topicId = topic.Topic;
        const isSelected = selectionState.topics.has(topic.Topic);
        const noSelection = selectionState.topics.size === 0;
        
        item.style.borderColor = isSelected ? color(topic.Topic) : '#e2e8f0';
        item.style.backgroundColor = isSelected ? d3.color(color(topic.Topic)).copy({opacity: 0.1}) : 'white';
        item.style.opacity = (noSelection || isSelected) ? 1 : 0.5;

        const detailsButtonHtml = isSelected ? `<div class="mt-2"><button class="keyword-details-btn text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-md hover:bg-indigo-200">キーワード比重</button></div>` : '';
        item.innerHTML = `
            <div class="flex items-center mb-1">
                <span class="w-4 h-4 rounded-full mr-2" style="background-color: ${color(topic.Topic)};"></span>
                <span class="font-bold text-sm text-slate-800">トピック ${topic.Topic}</span>
            </div>
            <p class="text-xs text-slate-600">${topic.Keywords}</p>${detailsButtonHtml}`;
        legendList.appendChild(item);
    });

    legendList.addEventListener('click', (e) => {
        const item = e.target.closest('.topic-legend-item');
        if (!item) return;
        const topicId = parseInt(item.dataset.topicId, 10);
        const topic = topics.find(t => t.Topic === topicId);
        if (e.target.closest('.keyword-details-btn')) {
            e.stopPropagation();
            showKeywordDetailsModal(topic);
        } else {
            onTopicClick(topicId);
        }
    });
}
