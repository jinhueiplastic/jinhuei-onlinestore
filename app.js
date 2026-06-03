// Google 試算表 ID
const SPREADSHEET_ID = '1UVjxSh9d7mFpdR3pZIWGG7TCJWiaYTIMN2apSQHjg0U';

// 針對這三頁不同的排版，做精準的欄位對應配置
// 注意：Google Visualization API 的 c[0]=A欄, c[1]=B欄, c[2]=C欄... 以此類推
const TABS_CONFIG = [
    { 
        tabName: '賣貨便-訂單', 
        platform: '賣貨便',
        dateIdx: 1,      // B 欄：訂單日期
        nameIdx: 13,     // N 欄：商品名稱
        specIdx: 14,     // O 欄：商品規格/選項
        qtyIdx: 15       // P 欄：數量
    },
    { 
        tabName: '好賣+訂單', 
        platform: '好賣+',
        dateIdx: 32,     // AG 欄：訂單成立時間
        nameIdx: 49,     // AX 欄：商品名稱
        specIdx: 50,     // AY 欄：商品規格/選項
        qtyIdx: 52       // BA 欄：數量
    },
    { 
        tabName: 'Order', 
        platform: '蝦皮',
        dateIdx: 3,      // D 欄：訂單成立日期
        nameIdx: 9,      // J 欄：商品名稱
        specIdx: 10,     // K 欄：商品選項名稱
        qtyIdx: null     // 蝦皮原始明細通常一列就是1件，若有數量欄位請改為對應索引
    }
];

let allOrdersData = []; // 存放所有分頁清洗後的總資料
let myChart = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 初始化事件監聽
    document.getElementById('platform-select').addEventListener('change', renderData);
    document.getElementById('month-select').addEventListener('change', renderData);
    document.getElementById('refresh-btn').addEventListener('click', loadAllTabsData);

    // 開始載入資料
    await loadAllTabsData();
});

// 異步讀取所有設定的分頁
async function loadAllTabsData() {
    document.getElementById('ranking-list').innerHTML = '<li class="py-3 text-gray-400 text-center">正在深度同步 3 個分頁資料...</li>';
    allOrdersData = []; // 清空舊資料

    const promises = TABS_CONFIG.map(async (config) => {
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(config.tabName)}`;
        try {
            const response = await fetch(url);
            const text = await response.text();
            const jsonString = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
            const data = JSON.parse(jsonString);
            
            parseRows(data.table.rows, config);
        } catch (err) {
            console.error(`讀取分頁 [${config.tabName}] 失敗:`, err);
        }
    });

    await Promise.all(promises);

    // 產生月份下拉選單
    initMonthSelect();
    
    // 渲染圖表與排行
    renderData();
}

// 解析各分頁資料
function parseRows(rows, config) {
    if (!rows || rows.length === 0) return;

    rows.forEach((row, index) => {
        if (index === 0) return; // 跳過第一列標頭
        if (!row.c) return;

        try {
            // 1. 擷取並解析日期 (轉換成 YYYY.MM 格式)
            let cellDate = row.c[config.dateIdx];
            let dateStr = cellDate ? String(cellDate.v) : '';
            if (!dateStr || dateStr.trim() === '') return;
            
            let yearMonth = '未知月份';
            const match = dateStr.match(/(\d{4})[年\/.-](\d{1,2})/);
            if (match) {
                const year = match[1];
                const month = match[2].padStart(2, '0');
                yearMonth = `${year}.${month}`;
            } else if (dateStr.includes('Date')) { 
                // 有時候 Google API 會把日期轉成 "Date(2026,3,23)" 格式 (月份從0開始算)
                const dateMatch = dateStr.match(/Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)/);
                if (dateMatch) {
                    const year = dateMatch[1];
                    const month = String(parseInt(dateMatch[2]) + 1).padStart(2, '0');
                    yearMonth = `${year}.${month}`;
                }
            }

            // 2. 擷取商品名稱與規格
            let cellName = row.c[config.nameIdx];
            let productName = cellName ? String(cellName.v).trim() : '';
            if (!productName || productName === 'null' || productName === '') return;

            let cellSpec = row.c[config.specIdx];
            let specName = cellSpec ? String(cellSpec.v).trim() : '';
            let fullProductName = (specName && specName !== 'null') ? `${productName} (${specName})` : productName;

            // 3. 擷取數量
            let quantity = 1;
            if (config.qtyIdx !== null && row.c[config.qtyIdx]) {
                let cellQty = row.c[config.qtyIdx].v;
                quantity = parseInt(cellQty) || 1;
            }

            allOrdersData.push({
                month: yearMonth,
                platform: config.platform,
                name: fullProductName,
                quantity: quantity
            });
        } catch (e) {
            // 忽略因空白列或特殊字元產生的錯誤
        }
    });
}

// 動態產生月份選單
function initMonthSelect() {
    const monthSelect = document.getElementById('month-select');
    const currentSelected = monthSelect.value;

    const months = [...new Set(allOrdersData.map(item => item.month))]
                    .filter(m => m !== '未知月份')
                    .sort((a, b) => b.localeCompare(a)); // 新到舊排序

    if (months.length === 0) {
        monthSelect.innerHTML = '<option value="all">無月份資料</option>';
        return;
    }

    let html = '<option value="all">全部月份 (年度累計)</option>';
    html += months.map(m => `<option value="${m}">${m.replace('.', ' 年 ')} 月</option>`).join('');
    monthSelect.innerHTML = html;

    if (currentSelected && html.includes(`value="${currentSelected}"`)) {
        monthSelect.value = currentSelected;
    } else {
        monthSelect.value = months[0]; // 預設選取最新的月份
    }
}

// 篩選與加總計算
function renderData() {
    const selectedPlatform = document.getElementById('platform-select').value;
    const selectedMonth = document.getElementById('month-select').value;

    let filtered = allOrdersData;

    if (selectedPlatform !== 'all') {
        filtered = filtered.filter(item => item.platform === selectedPlatform);
    }
    if (selectedMonth !== 'all') {
        filtered = filtered.filter(item => item.month === selectedMonth);
    }

    // 將相同商品名稱進行銷量加總
    const summary = {};
    filtered.forEach(item => {
        summary[item.name] = (summary[item.name] || 0) + item.quantity;
    });

    const sortedData = Object.keys(summary).map(name => ({
        name: name,
        quantity: summary[name]
    })).sort((a, b) => b.quantity - a.quantity);

    updateChart(sortedData);
    updateRankingList(sortedData);
}

// 渲染 Chart.js
function updateChart(data) {
    const ctx = document.getElementById('salesChart').getContext('2d');
    const labels = data.map(item => item.name);
    const values = data.map(item => item.quantity);

    if (myChart) myChart.destroy();

    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '銷售件數',
                data: values,
                backgroundColor: 'rgba(59, 130, 246, 0.75)',
                borderColor: 'rgba(59, 130, 246, 1)',
                borderWidth: 1,
                borderRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });
}

// 渲染右側清單
function updateRankingList(data) {
    const listContainer = document.getElementById('ranking-list');
    if (data.length === 0) {
        listContainer.innerHTML = '<li class="py-3 text-gray-400 text-center">該篩選條件下無銷售數據</li>';
        return;
    }

    listContainer.innerHTML = data.map((item, index) => `
        <li class="py-3 flex justify-between items-center">
            <div class="flex items-center gap-3 truncate mr-2">
                <span class="flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                    index < 3 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                }">
                    ${index + 1}
                </span>
                <span class="font-medium text-gray-700 truncate" title="${item.name}">${item.name}</span>
            </div>
            <span class="font-semibold text-blue-600 whitespace-nowrap">${item.quantity} 件</span>
        </li>
    `).join('');
}
