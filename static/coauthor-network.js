// coauthor-network.js
// タイムライン表示から「共著者ランキング」と「エゴネットワーク」の表示に機能を変更

/**
 * 右側のパネルに選択された著者間のネットワークを描画する（★ 複数選択対応）
 * @param {d3.Selection} svg - ネットワークを描画するSVG要素
 * @param {object} coAuthorData - 共著者データ (nodes, links)
 * @param {Set<string>} selectedAuthorIds - 選択された著者IDのセット
 * @param {string} mainAuthorName - 調査対象（主著者）のID
 * @param {object | null} existingForces - 既存のシミュレーションとフォース { sim, forceLink, forceCharge, forceCenter }
 * @param {object} params - スライダーからのパラメータ { linkDist, charge, linkStrengthBase, centerStrength }
 * @returns {object | null} - ★ 新しいシミュレーションとフォース { sim, forceLink, forceCharge, forceCenter }
 */
function renderSelectedAuthorNetwork(svg, coAuthorData, selectedAuthorIds, mainAuthorName, existingForces, params) {
    svg.selectAll("*").remove();
    const gMain = svg.append("g");

    const container = svg.node().parentElement;
    if (!container) return null;
    
    const { width: W, height: H } = container.getBoundingClientRect();
    if (W <= 0 || H <= 0) return null;

    // --- ズーム ---
    svg.call(d3.zoom()
        .scaleExtent([0.1, 8])
        .on("zoom", e => gMain.attr("transform", e.transform)));
        
    // --- 初期メッセージ ---
    if (selectedAuthorIds.size === 0 || !coAuthorData.nodes || !coAuthorData.links) {
        gMain.append("text")
            .attr("x", W / 2)
            .attr("y", H / 2)
            .attr("text-anchor", "middle")
            .style("font-size", "14px")
            .text("左のリストから著者を選択してください。");
        // ★ 既存のシミュレーションがあれば停止
        if (existingForces && existingForces.sim) {
            existingForces.sim.stop();
        }
        return null; // ★ シミュレーションを返さない
    }

    // --- 1. データ抽出 (★ 複数選択対応) ---
    const currentNodes = coAuthorData.nodes
        .filter(n => selectedAuthorIds.has(n.id))
        .map(n => ({ ...n })); // データをコピー

    const nodeMap = new Map(currentNodes.map(n => [n.id, n]));

    const currentLinks = coAuthorData.links
        .filter(l => {
            const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
            const targetId = typeof l.target === 'object' ? l.target.id : l.target;
            // リンクのsourceとtargetが両方とも選択されたノードに含まれている場合のみ
            return nodeMap.has(sourceId) && nodeMap.has(targetId);
        })
        .map(l => ({ // シミュレーション用にオブジェクトをマッピング
            source: nodeMap.get(typeof l.source === 'object' ? l.source.id : l.source),
            target: nodeMap.get(typeof l.target === 'object' ? l.target.id : l.target),
            weight: l.weight
        }));


    if (currentNodes.length === 0) {
         gMain.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle").text("選択された著者のデータが見つかりません。");
        if (existingForces && existingForces.sim) {
            existingForces.sim.stop();
        }
        return null;
    }
    
    // --- 2. シミュレーション設定 (★ 修正) ---
    let sim, forceLink, forceCharge, forceCenter;

    // ★ リンク強度の計算関数 (スライダーのベース値に基づいて調整)
    const getLinkStrength = (base) => (l) => (Number(base) / 0.5) * (0.1 + (l.weight / 10));

    if (existingForces && existingForces.sim) {
        // 既存のシミュレーションを再利用
        sim = existingForces.sim;
        forceLink = existingForces.forceLink;
        forceCharge = existingForces.forceCharge;
        forceCenter = existingForces.forceCenter;
        
        // パラメータをスライダーの現在値で更新
        forceLink.distance(Number(params.linkDist))
                 .strength(getLinkStrength(params.linkStrengthBase));
        forceCharge.strength(Number(params.charge));
        forceCenter.strength(Number(params.centerStrength));
        
    } else {
        // 新規作成
        forceLink = d3.forceLink(currentLinks)
                      .id(d => d.id)
                      .distance(Number(params.linkDist))
                      .strength(getLinkStrength(params.linkStrengthBase));
                      
        forceCharge = d3.forceManyBody().strength(Number(params.charge));
        
        forceCenter = d3.forceCenter(W / 2, H / 2).strength(Number(params.centerStrength));
        
        sim = d3.forceSimulation(currentNodes)
            .force("link", forceLink)
            .force("charge", forceCharge)
            .force("collision", d3.forceCollide().radius(d => 10 + Math.sqrt(d.paper_count) * 2 + 5))
            .force("center", forceCenter);
    }

    // --- 3. 描画グループ ---
    const linkGroup = gMain.append("g").attr("class", "links");
    const nodeGroup = gMain.append("g").attr("class", "nodes");
    
    let link = linkGroup.selectAll(".link");
    let node = nodeGroup.selectAll(".node");

    // --- 4. Tick関数 ---
    sim.on("tick", () => {
        link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        node.attr("transform", d => `translate(${d.x},${d.y})`);
    });
    
    // --- 5. 再描画・シミュレーション再起動 関数 (★ 順次アニメーション削除) ---
    function restartSimulation() {
        // --- ノードのData Join ---
        node = node.data(currentNodes, d => d.id);
        node.exit().remove();
        
        const nodeEnter = node.enter().append("g")
            .attr("class", "node")
            .style("opacity", 1) // ★ 初期透明度 1
            .call(d3.drag()
                .on("start", (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
                .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
                .on("end", (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
            );

        nodeEnter.append("circle")
            .attr("r", d => 10 + Math.sqrt(d.paper_count) * 2)
            .attr("fill", d => {
                // ★ 修正: 主著者かどうかで色分け
                return d.id === mainAuthorName ? "#b91c1c" : "#4f46e5"; // Red-700 or Indigo-600
            })
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5);
            
        nodeEnter.append("text")
            .attr("dy", ".35em")
            .attr("text-anchor", "middle")
            .style("font-size", d => d.id === mainAuthorName ? "14px" : "12px") // ★ 修正
            .style("font-weight", d => d.id === mainAuthorName ? "bold" : "normal") // ★ 修正
            .style("fill", "#ffffff") // ★ 修正: 全員白文字
            .style("paint-order", "stroke")
            .style("stroke", "#000000") // ★ 修正: 縁取りを黒に
            .style("stroke-width", "3px")
            .style("stroke-linejoin", "round")
            .text(d => d.id);

        nodeEnter.append("title")
            .text(d => `${d.id}\n共著論文数: ${d.paper_count}\n活動期間: ${d.start_year} - ${d.end_year}`);

        node = nodeEnter.merge(node); // ★ マージ

        // --- リンクのData Join ---
        link = link.data(currentLinks, d => `${d.source.id}-${d.target.id}`);
        link.exit().remove();
        
        const linkEnter = link.enter().append("line")
            .attr("class", "link")
            .attr("stroke", "#999")
            .attr("stroke-opacity", 0.6) // ★ 初期透明度 0.6
            .attr("stroke-width", d => Math.sqrt(d.weight));
        
        link = linkEnter.merge(link); // ★ マージ

        // --- シミュレーションの更新 ---
        sim.nodes(currentNodes);
        sim.force("link").links(currentLinks);
        sim.alpha(0.5).restart();
    }

    // --- 6. 実行 ---
    restartSimulation(); // ★ 一度だけ実行

    // ★ 修正: シミュレーションとフォースを返す
    return { sim, forceLink, forceCharge, forceCenter };
}


/**
 * ★ 削除: renderFullCoauthorNetwork 関数は renderSelectedAuthorNetwork に統合されたため削除
 */


/**
 * 左側のパネルに共著者ランキングを描画する
 * @param {HTMLElement} panel - ランキングを描画するHTML要素
 * @param {object} coAuthorData - 共著者データ (nodes, links)
 * @param {string} mainAuthorName - 主著者の名前
 * @param {function} onSelect - 著者が選択されたときのコールバック (authorId を引数)
 * @param {Set<string>} selectedAuthorIds - ★ 修正: 現在選択されている著者のIDセット
 * @param {function} onGroupAdd - ★ 追加: グループ追加ボタンのコールバック (引数なし)
 */
function renderAuthorRankList(panel, coAuthorData, mainAuthorName, onSelect, selectedAuthorIds, onGroupAdd) {
    // ★ 修正: ヘッダーとグループ追加ボタン
    panel.innerHTML = `
        <div class="flex justify-between items-center p-2">
            <h3 class="font-semibold text-lg">著者</h3>
            <button id="add-author-group-btn" class="bg-indigo-600 text-white font-semibold py-1 px-3 rounded-md hover:bg-indigo-700 text-xs" ${selectedAuthorIds.size === 0 ? 'disabled' : ''}>
                グループとして追加
            </button>
        </div>
    `;
    
    if (!coAuthorData || !coAuthorData.nodes) {
        panel.innerHTML += '<p class="text-slate-500 p-2">著者データがありません。</p>';
        return;
    }

    const list = document.createElement('ul');
    list.className = "space-y-1 p-2"; // ★ p-2 追加
    
    // ★ 修正: analyzer.py が主著者も返すようになったため、allPapers は不要
    const authors = [...coAuthorData.nodes].filter(n => n.id && n.paper_count > 0);

    // ★ 修正: 主著者を特定し、フラグを立て、リストの先頭に移動
    const mainAuthorIndex = authors.findIndex(a => a.id === mainAuthorName);
    if (mainAuthorIndex > -1) {
        const mainAuthorNode = authors.splice(mainAuthorIndex, 1)[0];
        mainAuthorNode.isMainAuthor = true;
        // paper_count でソートした後、先頭に追加
        authors.sort((a, b) => b.paper_count - a.paper_count);
        authors.unshift(mainAuthorNode);
    } else {
        // 主著者が見つからない場合（通常あり得ないが）、単純にソート
        authors.sort((a, b) => b.paper_count - a.paper_count);
    }

    authors.forEach(author => {
        const li = document.createElement('li');
        let text = `${author.id} (${author.paper_count}件)`;
        if (author.isMainAuthor) {
            text += " [調査対象]";
        }
        li.textContent = text;
        
        // ★ 修正: Set.has() で選択状態を確認
        const isSelected = selectedAuthorIds.has(author.id);
        
        li.className = `text-sm p-2 rounded-md cursor-pointer transition-colors ${
            isSelected 
                ? 'bg-indigo-600 text-white font-semibold' 
                : (author.isMainAuthor ? 'bg-red-100 text-red-800 hover:bg-red-200' : 'text-slate-700 hover:bg-indigo-100')
        }`;
        
        li.onclick = () => onSelect(author.id); 
        list.appendChild(li);
    });

    panel.appendChild(list);
    
    // ★ 追加: ボタンにクリックイベントを設定
    const groupAddBtn = panel.querySelector('#add-author-group-btn');
    if (groupAddBtn) {
        groupAddBtn.onclick = (e) => {
            e.stopPropagation();
            onGroupAdd();
        };
    }
}


/**
 * メイン関数 (旧 renderCoauthorTimeline)
 * コンテナを左右に分割し、ランキングとエゴネットワークを表示する
 * @param {d3.Selection} containerDiv - d3.select("#coauthor-container") から渡される *div* 要素
 * @param {object} data - メインデータ
 * @param {object} state - グローバル状態
 * @param {object} callbacks - コールバック関数
 */
function renderCoauthorTimeline(containerDiv, data, state, callbacks) { // ★ 引数名を 'svg' から 'containerDiv' に変更
    const { co_author_data, main_author_name } = data;
    // ★ 追加: visualization.js から onAuthorGroupAdd を受け取る
    const { onAuthorGroupAdd } = callbacks;
    
    // --- コンテナのセットアップ ---
    const container = containerDiv.node(); // ★ 'containerDiv.node()' が div#coauthor-container
    if (!container) return;

    // --- ★ 修正: レイアウト変更 (上部にコントロールパネルを追加) ---
    container.innerHTML = '';
    // container.className = 'flex w-full h-full ...'; // 以前のレイアウト
    container.className = 'flex flex-col w-full h-full'; // ★ 縦積みレイアウト

    // 1. コントロールパネル (スライダー用)
    const controlsPanel = document.createElement('div');
    controlsPanel.className = 'flex-shrink-0 p-2 border-b bg-slate-100 compact-slider-container';
    // スライダーのHTMLを定義
    controlsPanel.innerHTML = `
        <div class="grid grid-cols-4 gap-x-4 gap-y-2">
            <div>
                <label class="text-xs font-medium text-slate-700">リンク距離: <span id="linkDistValue">100</span></label>
                <div id="linkDistSlider"></div>
            </div>
            <div>
                <label class="text-xs font-medium text-slate-700">反発力: <span id="chargeValue">-400</span></label>
                <div id="chargeSlider"></div>
            </div>
            <div>
                <label class="text-xs font-medium text-slate-700">リンク強度: <span id="linkStrengthValue">0.5</span></label>
                <div id="linkStrengthSlider"></div>
            </div>
            <div>
                <label class="text-xs font-medium text-slate-700">中心引力: <span id="centerStrengthValue">0.1</span></label>
                <div id="centerStrengthSlider"></div>
            </div>
        </div>
    `;
    container.appendChild(controlsPanel);

    // 2. メインエリア (ランキング + ネットワーク)
    const mainArea = document.createElement('div');
    mainArea.className = 'flex-grow flex w-full h-full border border-gray-200 rounded-b-md min-h-0'; // ★ min-h-0 追加
    container.appendChild(mainArea);
    // --- ★ 修正ここまで ---


    // ★ 修正: Set<string> に変更
    let selectedAuthorIds = new Set();
    
    // ★ 修正: シミュレーションインスタンスとフォースを保持
    let sim = null;
    let forceLink = null;
    let forceCharge = null;
    let forceCenter = null;

    // --- 左パネル（ランキング）の作成 (mainArea に追加) ---
    const leftPanel = document.createElement('div');
    leftPanel.className = 'w-1/3 h-full p-2 border-r overflow-y-auto bg-slate-50';
    mainArea.appendChild(leftPanel); // ★ 修正

    // --- 右パネル（SVGコンテナ）の作成 (mainArea に追加) ---
    const rightPanel = document.createElement('div');
    rightPanel.className = 'w-2/3 h-full relative bg-white';
    mainArea.appendChild(rightPanel); // ★ 修正

    // ★ 修正: d3から渡されたSVGを操作するのではなく、*新しいSVGを作成* して d3.select でラップする
    const svgElement = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgElement.setAttribute('width', '100%');
    svgElement.setAttribute('height', '100%');
    rightPanel.appendChild(svgElement);
    
    const svg = d3.select(svgElement); // ★ 新しく作成したSVGを d3 で選択


    // --- ★ 追加: スライダーの初期化 ---
    const createSlider = (id, displayId, start, min, max, step, format) => {
        const sliderEl = controlsPanel.querySelector(`#${id}`);
        const displayEl = controlsPanel.querySelector(`#${displayId}`);
        if (!sliderEl) return null;
        
        const sliderInstance = noUiSlider.create(sliderEl, {
            start: [start], connect: [true, false], range: { 'min': min, 'max': max }, step: step,
            format: { to: val => val, from: val => Number(val) }
        });
        
        sliderInstance.on('update', (values) => {
            if(displayEl) displayEl.textContent = format(values[0]);
        });
        
        return sliderInstance;
    };

    const linkDistSlider = createSlider('linkDistSlider', 'linkDistValue', 100, 10, 300, 10, v => Math.round(v));
    const chargeSlider = createSlider('chargeSlider', 'chargeValue', -400, -2000, -50, 50, v => Math.round(v));
    const linkStrengthSlider = createSlider('linkStrengthSlider', 'linkStrengthValue', 0.5, 0.1, 2.0, 0.1, v => v.toFixed(1));
    const centerStrengthSlider = createSlider('centerStrengthSlider', 'centerStrengthValue', 0.1, 0, 1, 0.1, v => v.toFixed(1));

    // --- ★ 追加: スライダーのイベントリスナー ---
    const setupSliderListeners = () => {
        const sliders = [linkDistSlider, chargeSlider, linkStrengthSlider, centerStrengthSlider];
        sliders.forEach(slider => {
            slider?.on('slide', () => { // 'slide' イベントでリアルタイムに更新
                if (!sim) return; // シミュレーションがまだない場合は何もしない
                
                // 現在のスライダー値を取得
                const params = {
                    linkDist: linkDistSlider.get(),
                    charge: chargeSlider.get(),
                    linkStrengthBase: linkStrengthSlider.get(),
                    centerStrength: centerStrengthSlider.get()
                };

                // ★ リンク強度の計算関数
                const getLinkStrength = (base) => (l) => (Number(base) / 0.5) * (0.1 + (l.weight / 10));

                // フォースのパラメータを更新
                if (forceLink) {
                    forceLink.distance(Number(params.linkDist))
                             .strength(getLinkStrength(params.linkStrengthBase));
                }
                if (forceCharge) {
                    forceCharge.strength(Number(params.charge));
                }
                if (forceCenter) {
                    forceCenter.strength(Number(params.centerStrength));
                }
                
                // シミュレーションを再起動
                sim.alpha(0.3).restart();
            });
        });
    };
    setupSliderListeners();
    // --- ★ 追加ここまで ---


    // --- 選択コールバック (★ 複数選択トグルに変更) ---
    const handleAuthorSelect = (authorId) => { 
        // ★ 修正: Set をトグル
        if (selectedAuthorIds.has(authorId)) {
            selectedAuthorIds.delete(authorId); // 再クリックで選択解除
        } else {
            selectedAuthorIds.add(authorId); // クリックで追加
        }
        
        renderAuthorRankList(leftPanel, co_author_data, main_author_name, handleAuthorSelect, selectedAuthorIds, handleAuthorGroupAdd);
        
        // ★ 修正: sim とフォースを渡し、スライダーの値も渡す
        const forces = renderSelectedAuthorNetwork(svg, co_author_data, selectedAuthorIds, main_author_name, {
            sim, forceLink, forceCharge, forceCenter
        }, {
            linkDist: linkDistSlider.get(),
            charge: chargeSlider.get(),
            linkStrengthBase: linkStrengthSlider.get(),
            centerStrength: centerStrengthSlider.get()
        });

        // ★ 修正: 返されたシミュレーションとフォースを保存
        if (forces) {
            sim = forces.sim;
            forceLink = forces.forceLink;
            forceCharge = forces.forceCharge;
            forceCenter = forces.forceCenter;
        }
    };

    // ★ 追加: グループ追加ボタンのコールバック
    const handleAuthorGroupAdd = () => {
        if (selectedAuthorIds.size > 0 && onAuthorGroupAdd) {
            // visualization.js のコールバックを実行
            onAuthorGroupAdd(Array.from(selectedAuthorIds));
            // 選択をクリア
            selectedAuthorIds.clear();
            // UIを再描画
            renderAuthorRankList(leftPanel, co_author_data, main_author_name, handleAuthorSelect, selectedAuthorIds, handleAuthorGroupAdd);
            
            // ★ 修正: ネットワークもクリア
            const forces = renderSelectedAuthorNetwork(svg, co_author_data, selectedAuthorIds, main_author_name, {
                sim, forceLink, forceCharge, forceCenter
            }, {
                linkDist: linkDistSlider.get(),
                charge: chargeSlider.get(),
                linkStrengthBase: linkStrengthSlider.get(),
                centerStrength: centerStrengthSlider.get()
            });
            // ★ 修正: 返されたシミュレーションとフォースを保存
            if (forces) {
                sim = forces.sim;
                forceLink = forces.forceLink;
                forceCharge = forces.forceCharge;
                forceCenter = forces.forceCenter;
            }
        }
    };

    // --- 初期描画 ---
    renderAuthorRankList(leftPanel, co_author_data, main_author_name, handleAuthorSelect, selectedAuthorIds, handleAuthorGroupAdd);
    
    // ★ 修正: renderSelectedAuthorNetwork を呼ぶ
    // シミュレーションインスタンスを初期化するために、空でも一度呼び出す
    const forces = renderSelectedAuthorNetwork(svg, co_author_data, selectedAuthorIds, main_author_name, null, {
        linkDist: linkDistSlider.get(),
        charge: chargeSlider.get(),
        linkStrengthBase: linkStrengthSlider.get(),
        centerStrength: centerStrengthSlider.get()
    });
    
    // ★ 修正: 返されたシミュレーションとフォースを保存
    if (forces) {
        sim = forces.sim;
        forceLink = forces.forceLink;
        forceCharge = forces.forceCharge;
        forceCenter = forces.forceCenter;
    }
}