// console.log("[DEBUG] visualization.js ファイルがブラウザに読み込まれ、解析されました。");

document.addEventListener('DOMContentLoaded', () => {
    // console.log("[DEBUG] DOMContentLoaded イベントが発生しました。スクリプトの実行を開始します。");

    // --- グローバル変数 ---
    let currentData = null;
    let coAuthorCounts = new Map();
    let top10CoAuthors = new Set();
    let selectionState = {
        topics: new Set(),
        papers: new Set(),
        authors: new Set()
    };
    const color = d3.scaleOrdinal();

    // --- コンテキストとAPI呼び出しを外部に公開 ---
    window.getAnalysisContext = () => ({ selectionState, currentData });

    async function callGeminiAPI(prompt, retryCount = 5, delay = 1000) {
        const apiKey = "AIzaSyCVpxAuAx1e3cxlvy7kj2uxXbV4a_gycVA"; // Provided by the environment
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
        
        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.7,
                topP: 0.95,
                maxOutputTokens: 8192,
            }
        };

        for (let i = 0; i < retryCount; i++) {
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (response.ok) {
                    const result = await response.json();
                    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) return text;
                }
            } catch (error) {
                console.error(`API call attempt ${i + 1} failed:`, error);
            }
            if (i < retryCount - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Exponential backoff
            }
        }
        return "（エラー：テキストの生成に失敗しました。しばらくしてからもう一度お試しください。）";
    }
    window.callGeminiAPI = callGeminiAPI;


    // --- DOM要素の取得 ---
    const $infoPanel = document.getElementById('info-panel');
    const $selectionPanel = document.getElementById('selection-panel');
    const refetchAndAnalyzeButton = document.getElementById('refetchAndAnalyzeButton');
    const umapLegendContainer = document.getElementById('umap-legend-container');
    const legendPieContainer = document.getElementById('legend-pie-chart');
    const topicCountDisplay = document.getElementById('topicCountDisplay');
    
    const analysisParamsContainer = document.getElementById('analysis-params-content');
    const reanalyzeButton = document.getElementById('reanalyzeButton');

    const svgMain = d3.select("#mainNet");
    const svgCitation = d3.select("#citationNet");
    const svgCoauthor = d3.select("#coauthorNet");
    const svgDendrogram = d3.select("#dendrogramNet");
    
    // BERTopicモデル選択の要素
    const embeddingModelSelect = document.getElementById('embeddingModelSelect');
    const dimRedModelSelect = document.getElementById('dimRedModelSelect');
    const clusteringModelSelect = document.getElementById('clusteringModelSelect');
    const dendrogramTabButton = document.getElementById('dendrogram-tab-button');
    const dendrogramContent = document.getElementById('dendrogram-content');


    const createSlider = (container, id, displayId, start, min, max, step, format, changeCallback) => {
        const slider = container.querySelector(`#${id}`);
        const display = container.querySelector(`#${displayId}`);
        if (!slider) {
            console.error(`Slider element #${id} not found within its container.`);
            return null;
        }
        const noUiSliderInstance = noUiSlider.create(slider, {
            start: [start], connect: [true, false], range: { 'min': min, 'max': max }, step: step,
            format: { to: val => val, from: val => Number(val) }
        });
        noUiSliderInstance.on('update', (values) => { if(display) display.textContent = format(values[0]); });
        if (changeCallback) {
            noUiSliderInstance.on('end', changeCallback); // Use 'end' event to trigger on drag release
        }
        return noUiSliderInstance;
    };
    
    const reclusterCallback = () => requestAnalysisFromServer(false, true);

    const timeWeightSlider = createSlider(analysisParamsContainer, 'timeWeightSlider', 'timeWeightValue', 0, 0, 2, 0.01, v => v.toFixed(2), reclusterCallback);
    const neighborsSlider = createSlider(analysisParamsContainer, 'neighborsSlider', 'neighborsValue', 15, 2, 50, 1, v => Math.round(v), reclusterCallback);
    const minDistSlider = createSlider(analysisParamsContainer, 'minDistSlider', 'minDistValue', 0.1, 0, 1, 0.01, v => v.toFixed(2), reclusterCallback);
    
    // --- UMAPパラメータのUI制御 ---
    const toggleUmapParams = () => {
        if (!neighborsSlider || !minDistSlider) return;

        const isUmap = dimRedModelSelect.value === 'umap';
        const neighborsContainer = document.getElementById('neighborsSlider').closest('div.flex.flex-col');
        const minDistContainer = document.getElementById('minDistSlider').closest('div.flex.flex-col');

        if (isUmap) {
            neighborsSlider.enable();
            minDistSlider.enable();
            if (neighborsContainer) neighborsContainer.style.opacity = '1';
            if (minDistContainer) minDistContainer.style.opacity = '1';
        } else {
            neighborsSlider.disable();
            minDistSlider.disable();
            if (neighborsContainer) neighborsContainer.style.opacity = '0.5';
            if (minDistContainer) minDistContainer.style.opacity = '0.5';
        }
    };
    
    // --- Model Selection Change Listeners ---
    embeddingModelSelect.addEventListener('change', () => {
        // Embedding model change requires re-calculating embeddings.
        // recluster_only=true is okay because backend cache key depends on embedding model.
        reclusterCallback();
    });

    dimRedModelSelect.addEventListener('change', () => {
        toggleUmapParams();
        reclusterCallback();
    });

    clusteringModelSelect.addEventListener('change', () => {
        // HDBSCANが選択されている場合のみデンドログラムエリアを表示
        const isHdbscan = clusteringModelSelect.value === 'hdbscan';
        const dendrogramWrapper = document.getElementById('dendrogram-content');
        const hrSeparator = dendrogramWrapper ? dendrogramWrapper.previousElementSibling : null;

        if (dendrogramWrapper) dendrogramWrapper.style.display = isHdbscan ? '' : 'none';
        if (hrSeparator && hrSeparator.tagName === 'HR') hrSeparator.style.display = isHdbscan ? '' : 'none';

        reclusterCallback();
    });

    // 初期状態を設定
    toggleUmapParams();

    // --- Main Tab Switching ---
    const tabButtons = document.querySelectorAll('[data-tab-target]');
    const tabContents = document.querySelectorAll('[data-tab-content]');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const target = document.querySelector(button.dataset.tabTarget);
            tabContents.forEach(tabContent => tabContent.classList.remove('active'));
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            target.classList.add('active');
            rerenderAll();
        });
    });

    // --- Control Panelのタブ切り替えロジックはレイアウト変更により不要になったため削除 ---
    
    // --- データ取得と描画 ---
    if(refetchAndAnalyzeButton) refetchAndAnalyzeButton.addEventListener('click', () => requestAnalysisFromServer(true, false));
    if(reanalyzeButton) reanalyzeButton.addEventListener('click', () => requestAnalysisFromServer(false, true));
    
    // kの値を変更したら、再分析を促す
    const kInput = document.getElementById('k');
    if (kInput) {
        kInput.addEventListener('change', () => {
            // HDBSCANが選択されている場合のみ再クラスターを実行
            if(clusteringModelSelect.value === 'hdbscan') {
                requestAnalysisFromServer(false, true);
            }
        });
    }

    async function requestAnalysisFromServer(forceRefetchPaperData = false, reclusterOnly = false) {
        if (!timeWeightSlider || !neighborsSlider || !minDistSlider) {
            $infoPanel.innerHTML = "エラー: UIコンポーネントの初期化に失敗しました。";
            return;
        }
        const params = {
            aid: document.getElementById('aid').value.trim(),
            k: +document.getElementById('k').value,
            max_papers: +document.getElementById('max_papers').value,
            time_weight: +timeWeightSlider.get(),
            n_neighbors: +neighborsSlider.get(),
            min_dist: +minDistSlider.get(),
            embedding_model: embeddingModelSelect.value,
            dim_red_model: dimRedModelSelect.value,
            clustering_model: clusteringModelSelect.value,
        };
        
        $infoPanel.innerHTML = 'データを取得・分析中です...';
        if (topicCountDisplay) {
            topicCountDisplay.textContent = '...';
        }
        if (umapLegendContainer) umapLegendContainer.style.display = 'none';
        
        if (!reclusterOnly) {
            [svgMain, svgCitation, svgDendrogram, svgCoauthor].forEach(svg => svg.selectAll("*").remove());
            const temporalKeywordView = document.getElementById('temporal-keyword-view');
            if (temporalKeywordView) temporalKeywordView.innerHTML = '';
            selectionState = { topics: new Set(), papers: new Set(), authors: new Set() };
        }


        const url = new URL(`${window.location.origin}/data`);
        Object.keys(params).forEach(pKey => url.searchParams.append(pKey, params[pKey]));
        url.searchParams.append('force_refetch', forceRefetchPaperData);
        url.searchParams.append('recluster_only', reclusterOnly);
        
        try {
            const response = await d3.json(url);

            if (response.error) { throw new Error(response.error); }
            
            currentData = response;
            // 修正点: document_editor.js から参照できるようにグローバルスコープにデータを格納
            window.currentVisualizationData = currentData; 

            if (!reclusterOnly || forceRefetchPaperData) {
                calculateCoAuthorStats(currentData.nodes);
            }

            const topics = currentData.topic_info.filter(d => d.Topic !== -1);
            const numTopics = topics.length;

            if (topicCountDisplay) {
                topicCountDisplay.textContent = numTopics;
            }
             // K-Meansの場合、kの値を更新する
            if (params.clustering_model === 'kmeans' && kInput) {
                kInput.value = numTopics;
            }


            const colorScheme = [];
            if (numTopics > 0) {
                for (let i = 0; i < numTopics; i++) {
                    const hue = (i * (360 / numTopics)) % 360;
                    const saturation = 0.7;
                    const lightness = 0.55;
                    colorScheme.push(d3.hsl(hue, saturation, lightness).toString());
                }
            }
            color
                .domain(topics.map(t => t.Topic))
                .range(colorScheme)
                .unknown("#ccc");
            
            // Dendrogramの表示/非表示をデータに基づいて更新
            const isHdbscan = clusteringModelSelect.value === 'hdbscan' && currentData.dendrogram_data;
            const dendrogramWrapper = document.getElementById('dendrogram-content');
            const hrSeparator = dendrogramWrapper ? dendrogramWrapper.previousElementSibling : null;

            if (dendrogramWrapper) dendrogramWrapper.style.display = isHdbscan ? '' : 'none';
            if (hrSeparator && hrSeparator.tagName === 'HR') hrSeparator.style.display = isHdbscan ? '' : 'none';
            
            rerenderAll();
            
            if (isHdbscan) {
                renderDendrogram(svgDendrogram, currentData, { selectionState, color }, { reclusterCallback });
            } else {
                svgDendrogram.selectAll("*").remove();
            }
            
            $infoPanel.innerHTML = '分析完了。論文を選択してください。';
        } catch (error) {
            console.error("Failed to fetch or process data:", error);
            $infoPanel.innerHTML = `エラー: ${error.message}`;
            if (topicCountDisplay) {
                topicCountDisplay.textContent = 'Error';
            }
        }
    }

    function calculateCoAuthorStats(nodes) {
        coAuthorCounts.clear();
        top10CoAuthors.clear();
        if (!nodes) return;

        nodes.forEach(paper => {
            if (paper.authors && paper.authors.length > 0) {
                paper.authors.forEach(author => {
                    coAuthorCounts.set(author, (coAuthorCounts.get(author) || 0) + 1);
                });
            }
        });

        const sortedAuthors = [...coAuthorCounts.entries()].sort((a, b) => b[1] - a[1]);
        top10CoAuthors = new Set(sortedAuthors.slice(0, 10).map(entry => entry[0]));
    }

    function renderLegend(data) {
        if (!umapLegendContainer || !legendPieContainer) return;

        legendPieContainer.innerHTML = '';
    
        if (!data || !data.topic_info) return;
    
        const topics = data.topic_info.filter(t => t.Count > 0 && t.Topic !== -1);
        if (topics.length === 0) {
            legendPieContainer.innerHTML = '<p class="text-xs text-slate-500 p-4 text-center">表示するトピックがありません。</p>';
            umapLegendContainer.style.display = 'block';
            return;
        }
        const totalCount = d3.sum(topics, d => d.Count);
    
        const width = 120;
        const height = 120;
        const radius = Math.min(width, height) / 2;
        
        const svg = d3.select(legendPieContainer).append("svg")
            .attr("width", "100%")
            .attr("height", "100%")
            .attr("viewBox", `0 0 ${width} ${height}`)
            .attr("preserveAspectRatio", "xMidYMid meet")
            .append("g")
            .attr("transform", `translate(${width / 2}, ${height / 2})`);
    
        const pie = d3.pie()
            .value(d => d.Count)
            .sort(null);
    
        const arc = d3.arc()
            .innerRadius(radius * 0.5)
            .outerRadius(radius * 0.9);
        
        const outerArc = d3.arc()
            .innerRadius(radius * 0.5)
            .outerRadius(radius);
    
        const path = svg.selectAll("path")
            .data(pie(topics))
            .join("path")
            .attr("d", arc)
            .attr("fill", d => color(d.data.Topic))
            .style("cursor", "pointer")
            .attr("stroke", "#fff")
            .style("stroke-width", "1px")
            .attr("opacity", d => {
                const noSelection = selectionState.topics.size === 0;
                return (noSelection || selectionState.topics.has(d.data.Topic)) ? 1.0 : 0.3;
            });
    
        path.on("click", (event, d) => {
            onTopicClick(d.data.Topic);
        })
        .on("mouseover", function(event, d) {
            d3.select(this).transition().duration(100).attr("d", outerArc);
        })
        .on("mouseout", function(event, d) {
            d3.select(this).transition().duration(100).attr("d", arc);
        });
    
        path.append("title")
            .text(d => {
                const percentage = (d.data.Count / totalCount * 100).toFixed(1);
                return `トピック ${d.data.Topic}\n${d.data.Keywords}\n${d.data.Count}件 (${percentage}%)`;
            });
        
        svg.append("text")
            .attr("text-anchor", "middle")
            .attr("dy", "0.35em")
            .style("font-size", "16px")
            .style("font-weight", "bold")
            .text(totalCount);
        svg.append("text")
            .attr("text-anchor", "middle")
            .attr("dy", "1.5em")
            .style("font-size", "10px")
            .text("論文");
    
        umapLegendContainer.style.display = 'block';
    }

    function updateSelectionUI(data) {
        $selectionPanel.innerHTML = '';
        const { topics, papers, authors } = selectionState;
    
        if (topics.size === 0 && papers.size === 0 && authors.size === 0) {
            $selectionPanel.textContent = '選択なし';
            return;
        }
    
        const createDraggableTag = (text, payload) => {
            const tag = document.createElement('div');
            tag.className = 'selection-tag p-2 border rounded-md bg-slate-100 mb-1 cursor-grab';
            tag.textContent = text;
            tag.draggable = true;
            tag.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('application/json', JSON.stringify(payload));
                e.dataTransfer.effectAllowed = 'copy';
            });
            return tag;
        };
    
        authors.forEach(author => {
            const authorPapers = currentData.nodes.filter(p => p.authors && p.authors.includes(author));
            const coauthorCount = authorPapers.length;
            const topicCounts = d3.rollup(authorPapers.filter(p => p.topic !== -1), v => v.length, d => d.topic);
            const mostFrequentTopicId = topicCounts.size > 0 ? d3.greatest(topicCounts, ([, count]) => count)[0] : null;
            const mostFrequentTopic = mostFrequentTopicId !== null 
                ? currentData.topic_info.find(t => t.Topic === mostFrequentTopicId) 
                : null;
            const mostFrequentTopicKeywords = mostFrequentTopic ? mostFrequentTopic.Keywords : 'N/A';
    
            // [修正点 3] 著者ノードにすべての共著論文のアブストラクトと発行年を追加
            const coauthoredPapersDetails = authorPapers.map(p => ({
                title: p.title,
                abstract: p.abstract,
                year: p.year
            }));

            const payload = { 
                type: 'author', 
                name: `著者: ${author}`,
                stats: { // 既存の統計データ
                    coauthorCount: coauthorCount,
                    mostFrequentTopic: mostFrequentTopicKeywords
                },
                details: { // [修正点 3] 詳細な論文リストを追加
                    coauthoredPapers: coauthoredPapersDetails
                }
            };
            $selectionPanel.appendChild(createDraggableTag(`著者: ${author}`, payload));
        });
    
        topics.forEach(topicId => {
            const topic = data.topic_info.find(t => t.Topic === topicId);
            if (topic) {
                const topicPapers = currentData.nodes.filter(p => p.topic === topicId);
                const topCitedPapers = topicPapers.sort((a, b) => b.cit_cnt - a.cit_cnt).slice(0, 3);
                const yearDistribution = d3.rollup(topicPapers.filter(p => p.year > 0), v => v.length, d => d.year);
    
                // [修正点 2] トピックノードに属するすべての論文のアブストラクト、引用数、発行年を追加
                const allPapersInTopicDetails = topicPapers.map(p => ({
                    title: p.title,
                    abstract: p.abstract,
                    cit_cnt: p.cit_cnt,
                    year: p.year
                }));

                const topicName = `トピック: ${topic.Keywords.split(',')[0]}...`;
                const payload = { 
                    type: 'topic', 
                    name: topicName,
                    details: {
                        keywords: topic.Keywords, // 概要キーワード (コンマ区切り)
                        topCitedPapers: topCitedPapers.map(p => ({ title: p.title, year: p.year, cit_cnt: p.cit_cnt })),
                        yearDistribution: Array.from(yearDistribution.entries()).sort((a,b) => a[0] - b[0]),
                        // 'AllKeywords' は analyzer.py から topic_info に含まれている想定
                        
                        // [修正点 2] 追加
                        allPapersInTopic: allPapersInTopicDetails
                    }
                };
                $selectionPanel.appendChild(createDraggableTag(topicName, payload));
            }
        });
    
        papers.forEach(paperId => {
            const paper = data.nodes.find(p => p.paper_id === paperId);
            if (paper) {
                // 修正点: 論文が持つキーワードリストを渡す (analyzer.py が 'keywords' を返している場合)
                // もし analyzer.py が論文ごとのキーワードを返していない場合、フォールバックが必要
                const paperKeywords = paper.keywords || (currentData.keyword_coords ? Object.keys(currentData.keyword_coords) : []);
                
                const paperName = `論文: ${paper.title}`;
                const payload = { 
                    type: 'paper', 
                    name: paperName,
                    details: {
                        paper_id: paper.paper_id,
                        title: paper.title,
                        year: paper.year,
                        authors: paper.authors,
                        abstract: paper.abstract,
                        keywords: paperKeywords, // 論文固有のキーワード
                        
                        // [修正点 1] PDF URL を追加 (data_fetcher.py で追加された想定)
                        pdf_url: paper.pdf_url || "" 
                    }
                };
                $selectionPanel.appendChild(createDraggableTag(`論文: ${paper.title.substring(0, 30)}...`, payload));
            }
        });
        
        const clearButton = document.createElement('button');
        clearButton.textContent = 'クリア';
        clearButton.className = 'text-xs text-indigo-600 hover:underline mt-2';
        clearButton.onclick = onBackgroundClick;
        $selectionPanel.appendChild(clearButton);
    }
    
    function updateNodeStyles() {
        svgMain.selectAll(".node circle")
            .attr("stroke", d => selectionState.papers.has(d.paper_id) ? "#000" : "#fff")
            .attr("stroke-width", d => selectionState.papers.has(d.paper_id) ? 2.5 : 1.5);

        svgCitation.selectAll(".node circle")
            .attr("stroke", d => selectionState.papers.has(d.paper_id) ? "#000" : "#fff")
            .attr("stroke-width", d => selectionState.papers.has(d.paper_id) ? 2 : 1);
    }

    function onNodeClick(d) {
        selectionState.authors.clear();
        const id = d.paper_id;
        selectionState.papers.has(id) ? selectionState.papers.delete(id) : selectionState.papers.add(id);
        
        $infoPanel.innerHTML = `<strong>Title:</strong> ${d.title}<br><strong>Authors:</strong> ${d.authors.map(a => {
            const count = coAuthorCounts.get(a) || 0;
            let className = 'author-tag';
            if (top10CoAuthors.has(a)) {
                className += ' highlight';
            } else if (count <= 1) {
                className += ' faint';
            }
            return `<span class="${className}" data-author="${a}">${a}</span>`;
        }).join(', ')}`;
        
        $infoPanel.querySelectorAll('.author-tag:not(.faint)').forEach(tag => {
            tag.onclick = (e) => onAuthorClick(e.target.dataset.author);
        });
        
        updateSelectionUI(getRenderData());
        updateNodeStyles();
        rerenderAll();
    }

    function onTopicClick(topicId) {
        selectionState.authors.clear();
        selectionState.papers.clear();
        selectionState.topics.has(topicId) ? selectionState.topics.delete(topicId) : selectionState.topics.add(topicId);
        rerenderAll();
    }
    
    function onAuthorClick(authorName) {
        selectionState.papers.clear();
        selectionState.topics.clear();
        if (selectionState.authors.has(authorName)) {
            selectionState.authors.clear();
        } else {
            selectionState.authors.clear();
            selectionState.authors.add(authorName);
        }
        rerenderAll();
    }

    function onGroupClick(groupName, members) {
        // Clear previous selections and info panel content
        selectionState = { topics: new Set(), papers: new Set(), authors: new Set() };
        rerenderAll(); // Rerender to clear highlights etc.
        $infoPanel.innerHTML = '';
    
        if (members && members.length > 0) {
            let html = `<strong>${groupName} Members:</strong><br>`;
            // Sort members by their total paper count with the main author
            members.sort((a, b) => b.paper_count - a.paper_count);
            
            html += members.map(member => {
                const count = member.paper_count;
                let className = 'author-tag'; // Use the same styling as in onNodeClick
                if (top10CoAuthors.has(member.id)) {
                    className += ' highlight';
                }
                // Make the author tag clickable
                return `<span class="${className}" data-author="${member.id}" style="cursor: pointer;">${member.id} (${count})</span>`;
            }).join(', ');
            
            $infoPanel.innerHTML = html;
            
            // Add click listeners to the new author tags
            $infoPanel.querySelectorAll('.author-tag').forEach(tag => {
                tag.onclick = (e) => {
                    e.stopPropagation(); // Prevent event bubbling
                    onAuthorClick(e.target.dataset.author);
                };
            });
        } else {
            $infoPanel.innerHTML = `<strong>${groupName}</strong>: No members found.`;
        }
    }

    function onInstitutionGroupClick(groupName, members) {
        selectionState = { topics: new Set(), papers: new Set(), authors: new Set() };
        rerenderAll(); 
        $infoPanel.innerHTML = '';
    
        if (members && members.length > 0) {
            let html = `<strong>${groupName} Members:</strong><br>`;
            members.sort((a, b) => b.paper_count - a.paper_count);
            
            html += members.map(member => {
                const count = member.paper_count;
                // A simple span, not clickable for now.
                return `<span class="inline-block bg-slate-200 rounded px-2 py-1 text-xs font-semibold text-slate-700 mr-2 mb-2">${member.id} (${count})</span>`;
            }).join('');
            
            $infoPanel.innerHTML = html;
        } else {
            $infoPanel.innerHTML = `<strong>${groupName}</strong>: No members found.`;
        }
    }

    function onBackgroundClick() {
        selectionState = { topics: new Set(), papers: new Set(), authors: new Set() };
        $infoPanel.innerHTML = '論文を選択してください。';
        rerenderAll();
    }

    function getRenderData() {
        if (!currentData) return null;

        let nodes = currentData.nodes;

        const topicCounts = d3.rollup(nodes, v => v.length, d => d.topic);
        const topic_info = currentData.topic_info.map(topic => ({
            ...topic,
            Count: topicCounts.get(topic.Topic) || 0
        })).filter(topic => topic.Topic !== -1);

        return { ...currentData, nodes, topic_info };
    }

    function renderActiveTab(data) {
        if (!data) return;
        const activeTab = document.querySelector('[data-tab-content].active');
        if (!activeTab) return;

        const activeTabId = activeTab.id;
        const state = { selectionState, color };
        const callbacks = { onNodeClick, onBackgroundClick, onTopicClick, onAuthorClick, onGroupClick, onInstitutionGroupClick };

        // --- Tab-specific visibility ---
        // Explicitly control visibility of elements tied to a specific tab.
        if (umapLegendContainer) {
            umapLegendContainer.style.display = (activeTabId === 'umap-view') ? 'block' : 'none';
        }

        // --- Render content for the active tab ---
        switch (activeTabId) {
            case 'umap-view':
                renderUmapNetwork(svgMain, data, state, callbacks);
                renderLegend(data);
                break;
            case 'temporal-keyword-view':
                const container = document.getElementById('temporal-keyword-view');
                renderTemporalKeyword(container, data, state, callbacks);
                break;
            case 'citation-view':
                renderCitationNetwork(svgCitation, data, state, callbacks);
                break;
            case 'coauthor-view':
                renderCoauthorTimeline(svgCoauthor, data, state, callbacks);
                break;
            case 'synthesis-view':
                // This tab doesn't require a JS-based render function.
                // Having an explicit case prevents any other rendering logic from running.
                break;
        }
    }

    function rerenderAll() {
        const renderData = getRenderData();
        if (!renderData) {
            return;
        }
        updateSelectionUI(renderData);
        renderActiveTab(renderData);
    }
    
    document.addEventListener('selectPaperFromEditor', (e) => {
        const { paperId } = e.detail;
        if (currentData && currentData.nodes) {
            const paperNode = currentData.nodes.find(p => p.paper_id === paperId);
            if (paperNode) {
                selectionState.papers.clear();
                onNodeClick(paperNode);
            }
        }
    });
    
    window.addEventListener('resize', () => {
        clearTimeout(window.resizeTimer);
        window.resizeTimer = setTimeout(rerenderAll, 200);
    });

    // [修正点] ページ読み込み時の force_refetch を true から false に変更
    requestAnalysisFromServer(false);
});

