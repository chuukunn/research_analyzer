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
        authors: new Set(),
        excludedIds: new Set()
    };
    const color = d3.scaleOrdinal();

    // --- コンテキストとAPI呼び出しを外部に公開 ---
    window.getAnalysisContext = () => ({ selectionState, currentData });

    async function callGeminiAPI(prompt, retryCount = 3, delay = 1000) {
        const apiUrl = `/api/generate`;

        for (let i = 0; i < retryCount; i++) {
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: prompt })
                });

                if (response.ok) {
                    const result = await response.json();
                    if (result.text) return result.text;
                    if (result.error) throw new Error(result.error);
                } else {
                    let errorMsg = `HTTP Error ${response.status}`;
                    try {
                        const errJson = await response.json();
                        if (errJson.error) errorMsg += `: ${errJson.error}`;
                    } catch (e) { /* ignore */ }
                    throw new Error(errorMsg);
                }

            } catch (error) {
                console.error(`API call attempt ${i + 1} failed:`, error);
                if (i < retryCount - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                } else {
                    return `（エラー：テキストの生成に失敗しました。\n詳細: ${error.message}）`;
                }
            }
        }
        return "（エラー：テキストの生成に失敗しました。）";
    }
    window.callGeminiAPI = callGeminiAPI;


    // --- DOM要素の取得 ---
    const $infoPanel = document.getElementById('info-panel');
    const $selectionPanel = document.getElementById('selection-panel');
    const refetchAndAnalyzeButton = document.getElementById('refetchAndAnalyzeButton');
    const umapLegendContainer = document.getElementById('umap-legend-container');
    const excludeSelectedBtn = document.getElementById('exclude-selected-btn');
    const screenshotButton = document.getElementById('screenshotButton');
    const minAbsLenInput = document.getElementById('min_abs_len');
    const legendPieContainer = document.getElementById('legend-pie-chart');
    const topicCountDisplay = document.getElementById('topicCountDisplay');

    const analysisParamsContainer = document.getElementById('analysis-params-content');
    const reanalyzeButton = document.getElementById('reanalyzeButton');

    const svgMain = d3.select("#mainNet");
    const svgCitation = d3.select("#citationNet");
    const svgCoauthor = d3.select("#coauthor-container");
    // const svgDendrogram = d3.select("#dendrogramNet");

    // BERTopicモデル選択の要素
    const embeddingModelSelect = document.getElementById('embeddingModelSelect');
    const dimRedModelSelect = document.getElementById('dimRedModelSelect');
    const clusteringModelSelect = document.getElementById('clusteringModelSelect');

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
        noUiSliderInstance.on('update', (values) => { if (display) display.textContent = format(values[0]); });
        if (changeCallback) {
            noUiSliderInstance.on('end', changeCallback); // Use 'end' event to trigger on drag release
        }
        return noUiSliderInstance;
    };

    const reclusterCallback = () => requestAnalysisFromServer(false, true);

    const neighborsSlider = createSlider(analysisParamsContainer, 'neighborsSlider', 'neighborsValue', 15, 2, 50, 1, v => Math.round(v), reclusterCallback);
    const minDistSlider = createSlider(analysisParamsContainer, 'minDistSlider', 'minDistValue', 0.1, 0, 1, 0.01, v => v.toFixed(2), reclusterCallback);

    // Citation Network Layout Sliders
    // Callback is rerenderAll because it affects the layout of the citation network
    const citationVerticalGapSlider = createSlider(analysisParamsContainer, 'citationVerticalGapSlider', 'citationVerticalGapValue', 30, 10, 100, 5, v => Math.round(v), () => {
        const activeTabId = document.querySelector('[data-tab-content].active')?.id;
        if (activeTabId === 'citation-view') rerenderAll();
    });

    const citationHorizontalWidthSlider = createSlider(analysisParamsContainer, 'citationHorizontalWidthSlider', 'citationHorizontalWidthValue', 800, 400, 2000, 50, v => Math.round(v), () => {
        const activeTabId = document.querySelector('[data-tab-content].active')?.id;
        if (activeTabId === 'citation-view') rerenderAll();
    });

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

    const kmeansKInput = document.getElementById('kmeansKInput'); // K-Means/HDBSCAN共用の入力
    const clusterParamLabel = document.getElementById('cluster-param-label'); // ラベル

    clusteringModelSelect.addEventListener('change', () => {
        // ★ 修正: クラスタリングモデルに応じてラベルとデフォルト値を切り替え
        if (clusteringModelSelect.value === 'hdbscan') {
            clusterParamLabel.textContent = '最小クラスターサイズ (Min Cluster Size)';
            kmeansKInput.value = 5; // HDBScanのデフォルト
        } else {
            clusterParamLabel.textContent = 'ターゲットクラスター数 (k)';
            kmeansKInput.value = 8; // KMeansのデフォルト
        }
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

    // --- データ取得と描画 ---
    if (refetchAndAnalyzeButton) refetchAndAnalyzeButton.addEventListener('click', () => requestAnalysisFromServer(true, false));
    if (reanalyzeButton) reanalyzeButton.addEventListener('click', () => requestAnalysisFromServer(false, true));

    if (screenshotButton) {
        screenshotButton.addEventListener('click', () => {
            if (typeof html2canvas === 'undefined') {
                alert('html2canvas library is not loaded.');
                return;
            }

            // Capture the entire body with improved options
            html2canvas(document.body, {
                scale: 2, // Improve resolution
                useCORS: true, // Handle cross-origin resources (like fonts)
                logging: false, // Disable logging
                windowWidth: document.body.scrollWidth,
                windowHeight: document.body.scrollHeight
            }).then(canvas => {
                // Create a link to download the image
                const link = document.createElement('a');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                link.download = `research_analyzer_screenshot_${timestamp}.png`;
                link.href = canvas.toDataURL('image/png');
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }).catch(err => {
                console.error("Screenshot failed:", err);
                alert("Screenshot failed: " + err);
            });
        });
    }

    if (kmeansKInput) {
        kmeansKInput.addEventListener('change', () => {
            requestAnalysisFromServer(false, true);
        });
    }

    // --- Event Listeners for Filtering ---
    if (excludeSelectedBtn) {
        excludeSelectedBtn.addEventListener('click', () => {
            if (selectionState.papers.size === 0) return;
            // Add currently selected papers to excluded set
            selectionState.papers.forEach(pid => selectionState.excludedIds.add(pid));
            // Clear current selection
            selectionState.papers.clear();
            selectionState.topics.clear();
            selectionState.authors.clear();

            // Reset UI (this will call updateSelectionUI via onBackgroundClick logic partly, or we just rely on re-fetch)
            $infoPanel.innerHTML = '除外リストに追加しました。再分析中...';

            // Re-analyze
            requestAnalysisFromServer(true); // Re-cluster/Re-analyze
        });
    }

    if (minAbsLenInput) {
        minAbsLenInput.addEventListener('change', () => {
            requestAnalysisFromServer(true);
        });
    }

    async function requestAnalysisFromServer(forceRefetchPaperData = false, reclusterOnly = false) {
        if (!neighborsSlider || !minDistSlider) {
            $infoPanel.innerHTML = "エラー: UIコンポーネントの初期化に失敗しました。";
            return;
        }

        // 入力欄の値を取得 (HDBScanの場合は min_cluster_size として扱われる)
        let currentK = 8;
        if (kmeansKInput) {
            currentK = +kmeansKInput.value;
        }

        const params = {
            aid: document.getElementById('aid').value.trim(),
            source: document.getElementById('dataSourceSelect') ? document.getElementById('dataSourceSelect').value : 'openalex',
            k: currentK, // 選択された値を送信
            max_papers: +document.getElementById('max_papers').value,
            min_abs_len: +minAbsLenInput.value,
            min_abs_len: +minAbsLenInput.value,
            excluded_ids: Array.from(selectionState.excludedIds || []).join(','),
            time_weight: 0.0, // Default value as slider is removed
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
            [svgMain, svgCitation, svgCoauthor].forEach(svg => svg.selectAll("*").remove());
            const temporalKeywordView = document.getElementById('temporal-keyword-view');
            if (temporalKeywordView) temporalKeywordView.innerHTML = '';
            selectionState = { topics: new Set(), papers: new Set(), authors: new Set(), excludedIds: selectionState.excludedIds || new Set() };
        }


        const url = new URL(`${window.location.origin}/data`);
        Object.keys(params).forEach(pKey => url.searchParams.append(pKey, params[pKey]));
        url.searchParams.append('force_refetch', forceRefetchPaperData);
        url.searchParams.append('recluster_only', reclusterOnly);

        try {
            const response = await d3.json(url);

            if (response.error) { throw new Error(response.error); }

            currentData = response;
            window.currentVisualizationData = currentData;

            if (!reclusterOnly || forceRefetchPaperData) {
                calculateCoAuthorStats(currentData.nodes);
            }

            const topics = currentData.topic_info;
            const numTopics = topics.length;

            if (topicCountDisplay) {
                topicCountDisplay.textContent = numTopics;
            }

            const colorScheme = [];
            if (numTopics > 0) {
                // Topic -1 (outlier) should be at the end if it exists
                const hasOutlier = topics.some(t => t.Topic === -1);
                const regularTopics = topics.filter(t => t.Topic !== -1);
                const numRegularTopics = regularTopics.length;

                for (let i = 0; i < numRegularTopics; i++) {
                    const hue = (i * (360 / numRegularTopics)) % 360;
                    const saturation = 0.7;
                    const lightness = 0.55;
                    colorScheme.push(d3.hsl(hue, saturation, lightness).toString());
                }

                // Add grey for outlier at the end if it exists
                if (hasOutlier) {
                    colorScheme.push("#cccccc");
                }
            }

            // Sort topics so regular ones come first, then -1
            const sortedTopics = topics.sort((a, b) => {
                if (a.Topic === -1) return 1;
                if (b.Topic === -1) return -1;
                return a.Topic - b.Topic;
            });

            color
                .domain(sortedTopics.map(t => t.Topic))
                .range(colorScheme)
                .unknown("#ccc");

            // Explicitly set grey for topic -1 if it exists in the domain
            if (topics.some(t => t.Topic === -1)) {
                // We need to make sure -1 maps to #ccc. 
                // Since d3.scaleOrdinal maps domain index to range index, 
                // we might need to be careful. 
                // Alternatively, we can just handle it in the render function.
                // But let's try to force it here if possible, or just rely on the render function check.
            }

            // if (svgDendrogram) svgDendrogram.selectAll("*").remove();

            rerenderAll();

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

        const topics = data.topic_info.filter(t => t.Count > 0);
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
            .attr("fill", d => d.data.Topic === -1 ? "#cccccc" : color(d.data.Topic))
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
            .on("mouseover", function (event, d) {
                d3.select(this).transition().duration(100).attr("d", outerArc);
            })
            .on("mouseout", function (event, d) {
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

            const coauthoredPapersDetails = authorPapers.map(p => ({
                title: p.title,
                abstract: p.abstract,
                year: p.year
            }));

            const payload = {
                type: 'author',
                name: `著者: ${author}`,
                stats: {
                    coauthorCount: coauthorCount,
                    mostFrequentTopic: mostFrequentTopicKeywords
                },
                details: {
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
                        keywords: topic.Keywords,
                        topCitedPapers: topCitedPapers.map(p => ({ title: p.title, year: p.year, cit_cnt: p.cit_cnt })),
                        yearDistribution: Array.from(yearDistribution.entries()).sort((a, b) => a[0] - b[0]),
                        allPapersInTopic: allPapersInTopicDetails
                    }
                };
                $selectionPanel.appendChild(createDraggableTag(topicName, payload));
            }
        });

        papers.forEach(paperId => {
            const paper = data.nodes.find(p => p.paper_id === paperId);
            if (paper) {
                // ★ 修正: 論文自身のキーワードに加え、所属トピックのキーワードも取得して結合する
                let combinedKeywords = [];
                // 1. 論文自身のキーワード
                if (paper.keywords) {
                    combinedKeywords = Array.isArray(paper.keywords) ? paper.keywords : [paper.keywords];
                }

                // 2. 所属トピックのキーワード
                if (paper.topic !== undefined && paper.topic !== null) {
                    const topicInfo = data.topic_info.find(t => t.Topic === paper.topic);
                    if (topicInfo && topicInfo.Keywords) {
                        const topicKws = topicInfo.Keywords.split(',').map(s => s.trim());
                        combinedKeywords = [...combinedKeywords, ...topicKws];
                    }
                }

                // 重複排除
                const paperKeywords = [...new Set(combinedKeywords)];

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
                        keywords: paperKeywords,
                        pdf_url: paper.pdf_url || ""
                    }
                };
                $selectionPanel.appendChild(createDraggableTag(`論文: ${paper.title.substring(0, 30)}...`, payload));
            }
        });

        // Show/Hide Exclude Button based on selection
        if (papers.size > 0 && excludeSelectedBtn) {
            excludeSelectedBtn.classList.remove('hidden');
        } else if (excludeSelectedBtn) {
            excludeSelectedBtn.classList.add('hidden');
        }

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
            // ★ 修正: 調査対象の著者は青くする
            if (currentData && currentData.main_author_name === a) {
                className += ' text-blue-600 font-bold';
            } else if (top10CoAuthors.has(a)) {
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

        // ★ 修正: rerenderAll() を呼ばずにスタイル更新のみを行う (Citation Network)
        // 他のネットワーク図もスタイル更新のみで済むならそうすべきだが、
        // ここでは要望のあったCitation Networkに対する最適化を行う。
        // ただし、selectionStateはグローバルなので、他タブへの影響も考慮必要。
        // 現在アクティブなタブがCitation Viewなら updateNodeStyles だけ呼ぶ。
        const activeTabId = document.querySelector('[data-tab-content].active')?.id;

        if (activeTabId === 'citation-view') {
            updateNodeStyles(); // これは visualization.js 内の関数
            // updateNodeStyles関数内で citation-network.js の updateNodeStyles を呼ぶ必要があるが、
            // 実装上は svgCitation.selectAll... で直接やっているため OK。
        } else {
            rerenderAll();
        }
    }

    function onTopicClick(topicId) {
        selectionState.authors.clear();
        selectionState.papers.clear();
        selectionState.topics.has(topicId) ? selectionState.topics.delete(topicId) : selectionState.topics.add(topicId);
        rerenderAll();
    }

    function onAuthorClick(authorName, accumulate = false) {
        if (!accumulate) {
            selectionState.papers.clear();
            selectionState.topics.clear();
            if (selectionState.authors.has(authorName)) {
                selectionState.authors.clear();
            } else {
                selectionState.authors.clear();
                selectionState.authors.add(authorName);
            }
        } else {
            // 累積モード (Add to Selection)
            if (!selectionState.authors.has(authorName)) {
                selectionState.authors.add(authorName);
            }
            // 既に選択されていても削除はしない (明示的に追加する意図なので)
        }
        rerenderAll();
    }

    // ★ 修正: papers (timelineData) と authorIds を受け取る
    const handleAuthorGroupAdd = (papers, authorIds) => {
        if (!currentData || !currentData.co_author_data || !currentData.co_author_data.nodes) {
            console.warn("Cannot add author group: co_author_data is not ready.");
            return;
        }

        const coAuthorNodeMap = new Map(currentData.co_author_data.nodes.map(n => [n.id, n]));

        const authorDetails = authorIds
            .map(id => {
                // その著者が関与している論文のみを抽出
                let relatedPapers = [];
                // ★ 修正: メイン著者の場合、グループ内の全論文が関与しているはずなので、マッチング漏れを防ぐために全論文を対象とする
                // (ただし、Paper Modeの場合は名前が一致しないのでこのロジックはAuthor Mode用)
                if (currentData && currentData.main_author_name === id) {
                    relatedPapers = papers;
                } else {
                    relatedPapers = papers.filter(p => p.authors && p.authors.includes(id));
                }

                const count = relatedPapers.length;

                let startYear = '?';
                let endYear = '?';
                if (count > 0) {
                    const years = relatedPapers.map(p => p.year).filter(y => y > 0);
                    if (years.length > 0) {
                        startYear = Math.min(...years);
                        endYear = Math.max(...years);
                    }
                }

                // Globalな情報も参照したければ node から取れるが、
                // ユーザー要望「グループ構成員の共著の年代と矛盾した情報」を避けるため、
                // このグループに含まれる論文(timelineData)ベースで計算した値を優先する。
                // ただし、メタ情報(論文リスト)も保持する。

                return {
                    id: id,
                    paper_count: count,
                    start_year: startYear,
                    end_year: endYear,
                    papers: relatedPapers.map(p => ({ title: p.title, year: p.year, cit_cnt: p.cit_cnt })) // メタ情報
                };
            });

        if (window.addEditorBlock) {
            window.addEditorBlock({
                type: 'author_group',
                name: `著者グループ (${authorIds.length}名)`,
                details: {
                    authors: authorDetails,
                    timelineData: papers // ★ 論文データを渡す
                }
            });
        }
    };


    function onGroupClick(groupName, members) {
        selectionState = { topics: new Set(), papers: new Set(), authors: new Set(), excludedIds: selectionState.excludedIds || new Set() };
        rerenderAll();
        $infoPanel.innerHTML = '';

        if (members && members.length > 0) {
            let html = `<strong>${groupName} Members:</strong><br>`;
            members.sort((a, b) => b.paper_count - a.paper_count);

            html += members.map(member => {
                const count = member.paper_count;
                let className = 'author-tag';
                if (top10CoAuthors.has(member.id)) {
                    className += ' highlight';
                }
                return `<span class="${className}" data-author="${member.id}" style="cursor: pointer;">${member.id} (${count})</span>`;
            }).join(', ');

            $infoPanel.innerHTML = html;

            $infoPanel.querySelectorAll('.author-tag').forEach(tag => {
                tag.onclick = (e) => {
                    e.stopPropagation();
                    onAuthorClick(e.target.dataset.author);
                };
            });
        } else {
            $infoPanel.innerHTML = `<strong>${groupName}</strong>: No members found.`;
        }
    }

    function onInstitutionGroupClick(groupName, members) {
        selectionState = { topics: new Set(), papers: new Set(), authors: new Set(), excludedIds: selectionState.excludedIds || new Set() };
        rerenderAll();
        $infoPanel.innerHTML = '';

        if (members && members.length > 0) {
            let html = `<strong>${groupName} Members:</strong><br>`;
            members.sort((a, b) => b.paper_count - a.paper_count);

            html += members.map(member => {
                const count = member.paper_count;
                return `<span class="inline-block bg-slate-200 rounded px-2 py-1 text-xs font-semibold text-slate-700 mr-2 mb-2">${member.id} (${count})</span>`;
            }).join('');

            $infoPanel.innerHTML = html;
        } else {
            $infoPanel.innerHTML = `<strong>${groupName}</strong>: No members found.`;
        }
    }

    function onBackgroundClick() {
        selectionState = { topics: new Set(), papers: new Set(), authors: new Set(), excludedIds: selectionState.excludedIds || new Set() };
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
        })).filter(topic => true); // Keep all topics including -1

        return { ...currentData, nodes, topic_info };
    }

    function renderActiveTab(data) {
        if (!data) return;
        const activeTab = document.querySelector('[data-tab-content].active');
        if (!activeTab) return;

        const activeTabId = activeTab.id;
        const state = { selectionState, color };
        const callbacks = {
            onNodeClick,
            onBackgroundClick,
            onTopicClick,
            onAuthorClick,
            onGroupClick,
            onInstitutionGroupClick,
            onAuthorGroupAdd: handleAuthorGroupAdd
        };

        if (umapLegendContainer) {
            umapLegendContainer.style.display = (activeTabId === 'umap-view') ? 'block' : 'none';
        }

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
                const verticalGap = citationVerticalGapSlider ? +citationVerticalGapSlider.get() : 30;
                const horizontalWidth = citationHorizontalWidthSlider ? +citationHorizontalWidthSlider.get() : 800;
                renderCitationNetwork(svgCitation, data, state, callbacks, verticalGap, horizontalWidth);
                break;
            case 'coauthor-view':
                renderCoauthorTimeline(svgCoauthor, data, state, callbacks);
                break;
            case 'synthesis-view':
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

    requestAnalysisFromServer(false);
});