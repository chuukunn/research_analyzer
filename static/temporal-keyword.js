// temporal-keyword.js

let temporalChartType = 'stream'; // 'stream' or 'bar'

/**
 * トピック要約モーダル
 * APIを呼び出してトピックの要約を生成・表示します。
 * @param {object} topic - トピック情報 (topic_info の要素)
 * @param {Array} allNodes - 全論文ノードのリスト (currentData.nodes)
 */
async function showKeywordDetailsModal(topic, allNodes) {
    const modal = document.getElementById('keyword-modal');
    const titleEl = document.getElementById('modal-title');
    const contentEl = document.getElementById('modal-content');
    const closeBtn = document.getElementById('modal-close-btn');

    if (!modal || !titleEl || !contentEl || !closeBtn) {
        console.error('Modal elements not found!');
        return;
    }

    // 修正点 3: タイトルを「トピック要約」に変更
    titleEl.textContent = `トピック ${topic.Topic} - 要約`;
    
    contentEl.innerHTML = '<p class="text-slate-500">トピックの要約を生成中です...</p>';

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

    // --- 修正点 3: 要約生成ロジック ---
    try {
        if (!window.callGeminiAPI) {
            throw new Error("Gemini API (window.callGeminiAPI) が見つかりません。");
        }

        const topicNodes = allNodes.filter(node => node.topic === topic.Topic);
        
        // プロンプトに含める論文情報を構築（引用数上位10件）
        const papersInfo = topicNodes
            .sort((a, b) => b.cit_cnt - a.cit_cnt) // 引用数でソート
            .slice(0, 10) // 上位10件
            .map(p => `- "${p.title}" (${p.year}), 引用数: ${p.cit_cnt}, 要旨: ${p.abstract ? p.abstract.substring(0, 150) + '...' : 'N/A'}`);

        // 詳細キーワード情報（上位15件）
        const keywordsInfo = (topic.AllKeywords || [])
            .slice(0, 15) // 上位15キーワード
            .map(kw => `${kw.word} (スコア: ${kw.score.toFixed(3)})`)
            .join(', ');

        const prompt = `
以下の情報に基づき、学術的なトピック（研究テーマ）について、その概要と重要性を解説する日本語の要約（約200～300文字程度）を作成してください。

# トピック情報
- トピックID: ${topic.Topic}
- 主要キーワード (c-TF-IDF): ${topic.Keywords}
- 詳細キーワード (上位15件): ${keywordsInfo}
- トピック内の論文数: ${topicNodes.length} 件

# トピック内の主要論文 (引用数トップ10)
${papersInfo.join('\n')}

# 要約の構成
1. このトピックがどのような研究テーマ（分野）であるかを定義してください。
2. このトピックの主な貢献や焦点（例えば、特定の手法、特定の課題への応用など）を説明してください。
3. この分野における重要性や変遷について簡潔に触れてください。
`;

        const summaryText = await window.callGeminiAPI(prompt);
        
        // 生成されたテキストを整形して表示
        contentEl.innerHTML = `
            <div class="prose prose-sm max-w-none">
                <p>${summaryText.replace(/\n/g, '<br>')}</p>
                <hr class="my-3">
                <h4 class="font-semibold mb-2">トピックの主要キーワード (c-TF-IDF)</h4>
                <p class="text-xs text-slate-600">${topic.Keywords}</p>
            </div>
        `;

    } catch (error) {
        console.error("トピック要約の生成に失敗しました:", error);
        contentEl.innerHTML = `<p class="text-red-500">要約の生成に失敗しました: ${error.message}</p>`;
    }
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
    
    // --- 修正点: topicIds の順序をカスタマイズ ---
    let topicIds = topic_info.map(t => t.Topic).filter(id => id !== -1);
    
    // 要求2: クリックしたトピック（1つの場合）をリストの先頭（＝底辺）に移動
    if (selectionState.topics.size === 1) {
        const selectedTopicId = [...selectionState.topics][0];
        const index = topicIds.indexOf(selectedTopicId);
        if (index > -1) {
            topicIds.splice(index, 1); // 削除
            topicIds.unshift(selectedTopicId); // 先頭に追加
        }
    }
    // --- 修正ここまで ---

    const dataForStream = Array.from(countsByYearTopic.entries()).map(([year, topics]) => ({ year, ...Object.fromEntries(topicIds.map(id => [id, topics.get(id) || 0])) })).sort((a, b) => a.year - b.year);

    if (dataForStream.length < 2) {
        svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle").text("表示期間のデータが不足しています。");
        return;
    }

    const series = d3.stack()
        .keys(topicIds)
        .order(d3.stackOrderNone) // 修正点 2: keysの順序(カスタマイズ済み)をそのまま使う
        .offset(d3.stackOffsetExpand) // 修正点 1: 割合(0-1)で表示
        (dataForStream);
        
    const xScale = d3.scaleLinear()
        .domain(d3.extent(dataForStream, d => d.year))
        .range([MARGIN.left, W - MARGIN.right]);
        
    const yScale = d3.scaleLinear()
        .domain([0, 1]) // 修正点 1: 割合(0-1)
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
    svg.append("g").attr("transform", `translate(${MARGIN.left}, 0)`).call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format(".0%"))); // 修正点 1: %フォーマット
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
    
    // --- 修正点: topicIds の順序をカスタマイズ ---
    let topicIds = topic_info.map(t => t.Topic).filter(id => id !== -1);
    
    // 要求2: クリックしたトピック（1つの場合）をリストの先頭（＝底辺）に移動
    if (selectionState.topics.size === 1) {
        const selectedTopicId = [...selectionState.topics][0];
        const index = topicIds.indexOf(selectedTopicId);
        if (index > -1) {
            topicIds.splice(index, 1); // 削除
            topicIds.unshift(selectedTopicId); // 先頭に追加
        }
    }
    // --- 修正ここまで ---

    const dataForStack = Array.from(countsByYearTopic.entries()).map(([year, topics]) => ({ year, ...Object.fromEntries(topicIds.map(id => [id, topics.get(id) || 0])) })).sort((a, b) => a.year - b.year);
    
    if (dataForStack.length === 0) return;

    const series = d3.stack()
        .keys(topicIds)
        .order(d3.stackOrderNone) // 修正点 2: keysの順序(カスタマイズ済み)をそのまま使う
        .offset(d3.stackOffsetExpand) // 修正点 1: 割合(0-1)で表示
        (dataForStack);

    const years = dataForStack.map(d => d.year);
    const xScale = d3.scaleBand().domain(years).range([MARGIN.left, W - MARGIN.right]).padding(0.2);
    const yScale = d3.scaleLinear().domain([0, 1]).nice().range([H - MARGIN.bottom, MARGIN.top]); // 修正点 1: 割合(0-1)

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
                // 修正点 1: 割合を表示
                const percentage = (d[1] - d[0]) * 100;
                return `${topic ? topic.Keywords : `Topic ${topicKey}`}\nYear: ${d.data.year}\n割合: ${percentage.toFixed(1)}%`;
            });

    svg.on("click", onBackgroundClick);
    const xAxis = g.append("g").attr("transform", `translate(0,${H - MARGIN.bottom})`).call(d3.axisBottom(xScale).tickValues(xScale.domain().filter((d,i) => !(i%Math.ceil(years.length/10)) || i === years.length - 1)));
    xAxis.selectAll("text").attr("transform", "rotate(-45)").style("text-anchor", "end");
    g.append("g").attr("transform", `translate(${MARGIN.left},0)`).call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format(".0%"))); // 修正点 1: %フォーマット
}


function renderKeywordLegend(container, data, state, callbacks) {
    const { topic_info, nodes } = data; // 'nodes' を data から取得
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

        // 修正点 3: ボタンテキストを「トピック要約」に変更
        const detailsButtonHtml = isSelected ? `<div class="mt-2"><button class="keyword-details-btn text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-md hover:bg-indigo-200">トピック要約</button></div>` : '';
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
            // 修正点 3: 'nodes' (allNodes) をモーダル関数に渡す
            showKeywordDetailsModal(topic, nodes); 
        } else {
            onTopicClick(topicId);
        }
    });
}