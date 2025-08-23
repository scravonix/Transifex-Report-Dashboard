let data = [];
let lastSortField = '';
let sortDirection = 1;
let pendingCsvFile = null;
let currentPage = 1;
const itemsPerPage = 8;
let editorSearchTerm = '';
let isChartAnimating = false;

let undoTimer = null;
let pendingLoadName = null;

let mainChart, editPieChart, reviewPieChart;

function getCurrentLanguage() {
    const savedLang = localStorage.getItem('language');
    if (savedLang && translations[savedLang]) return savedLang;
    const browserLang = navigator.language.split('-')[0];
    if (translations[browserLang]) return browserLang;
    return 'tr';
}
function saveLanguage(lang) {
    localStorage.setItem('language', lang);
}
const currentLang = getCurrentLanguage();

function applyTranslations() {
    const lang = getCurrentLanguage();
    const t = translations[lang];
    document.querySelectorAll('[data-translate-key]').forEach(el => {
        const key = el.getAttribute('data-translate-key');
        if (t[key]) el.textContent = t[key];
    });
    document.querySelectorAll('[data-translate-key-placeholder]').forEach(el => {
        const key = el.getAttribute('data-translate-key-placeholder');
        if (t[key]) el.placeholder = t[key];
    });
    document.title = t.appTitle;
    const themeButton = document.getElementById('toggleTheme');
    themeButton.textContent = document.body.classList.contains('dark') ? t.themeButtonLight : t.themeButtonDark;
    if (mainChart) {
        mainChart.data.datasets[0].label = t.editLabel;
        mainChart.data.datasets[1].label = t.reviewLabel;
        mainChart.update();
    }
}

function saveData() {
  localStorage.setItem("chartData", JSON.stringify(data));
}
const saved = localStorage.getItem("chartData");
if (saved) {
  data = JSON.parse(saved);
} else {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  data = [{
    Project: translations[currentLang].exampleProject,
    Edit_total: 100,
    Review_total: 50,
    year: currentYear,
    month: currentMonth
  }];
}

function populateDateSelectors(yearSelectorId, monthSelectorId, selectedYear, selectedMonth) {
  const yearSelect = document.getElementById(yearSelectorId);
  const monthSelect = document.getElementById(monthSelectorId);
  const t = translations[getCurrentLanguage()];
  yearSelect.innerHTML = '';
  monthSelect.innerHTML = '';
  const currentYear = new Date().getFullYear();
  for (let i = currentYear + 5; i >= 2020; i--) {
    yearSelect.add(new Option(i, i));
  }
  t.months.forEach((month, index) => {
    monthSelect.add(new Option(month, index));
  });
  yearSelect.value = selectedYear || currentYear;
  monthSelect.value = selectedMonth !== undefined ? selectedMonth : new Date().getMonth();
}

function showToast(message, type = 'info') {
  const toastContainer = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hide');
    toast.addEventListener('transitionend', () => toast.remove());
  }, 3500);
}

function showUndoToast(message, undoCallback) {
    const t = translations[getCurrentLanguage()];
    if (undoTimer) {
        clearTimeout(undoTimer);
        document.querySelector('.toast-undo')?.remove();
    }

    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast toast-warning toast-undo';

    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;

    const undoButton = document.createElement('button');
    undoButton.textContent = t.undoButton;
    undoButton.onclick = () => {
        clearTimeout(undoTimer);
        undoCallback();
        toast.remove();
        showToast(t.toastActionUndone, 'info');
    };
    
    const progressBar = document.createElement('div');
    progressBar.className = 'toast-progress';

    toast.appendChild(messageSpan);
    toast.appendChild(undoButton);
    toast.appendChild(progressBar);
    toastContainer.appendChild(toast);

    undoTimer = setTimeout(() => {
        toast.classList.add('hide');
        toast.addEventListener('transitionend', () => toast.remove());
        undoTimer = null;
    }, 10000);
}


function updateTotals(dataToRender = []) {
  document.getElementById("totalEdit").textContent = dataToRender.reduce((a, b) => a + (b.Edit_total || 0), 0);
  document.getElementById("totalReview").textContent = dataToRender.reduce((a, b) => a + (b.Review_total || 0), 0);
}

function getTextColor() {
  return document.body.classList.contains("dark") ? "#e2e8f0" : "#1e293b";
}

function refreshAll() {
  populateFilterDateSelectors(); 
  applyFiltersAndRender();
  renderSidebar(getFilteredData());
  renderEditorList();
  saveData();
}

function getFilteredData() {
    const viewType = document.getElementById('viewType').value;
    
    if (viewType === 'aggregated') {
        const selectedReport = document.getElementById('aggregatedReportSelector').value;
        if (!selectedReport) return [];
        return data.filter(d => d.reportName === selectedReport);
    }
    const datedData = data.filter(d => d.hasOwnProperty('month'));
    if (viewType === 'singleMonthProject') {
        const year = parseInt(document.getElementById('singleYear').value);
        const month = parseInt(document.getElementById('singleMonth').value);
        if (isNaN(year) || isNaN(month)) return [];
        return datedData.filter(d => d.year === year && d.month === month);
    } 
    else {
        const startYear = parseInt(document.getElementById('startYear').value);
        const startMonth = parseInt(document.getElementById('startMonth').value);
        const endYear = parseInt(document.getElementById('endYear').value);
        const endMonth = parseInt(document.getElementById('endMonth').value);
        if (isNaN(startYear) || isNaN(endYear)) return datedData;
        const startDate = new Date(startYear, startMonth, 1);
        const endDate = new Date(endYear, endMonth + 1, 0);
        return datedData.filter(d => {
            const itemDate = new Date(d.year, d.month, 15);
            return itemDate >= startDate && itemDate <= endDate;
        });
    }
}

function applyFiltersAndRender() {
    isChartAnimating = true;
    const filteredData = getFilteredData();
    const viewType = document.getElementById('viewType').value;
    const chartType = document.getElementById('chartTypeSelect').value;
    const t = translations[getCurrentLanguage()];

    if (viewType === 'aggregated' && filteredData.length === 0) {
        const anyAggregatedDataExists = data.some(d => d.hasOwnProperty('reportName'));
        if (!anyAggregatedDataExists) {
            showToast(t.toastNoAggregatedData, 'warning');
        }
    }
    if (chartType === 'pie') {
        const chartData = aggregateDataByProject(filteredData);
        const colors = generateDistinctColors(chartData.labels.length);
        const positiveEditData = [], positiveEditLabels = [], positiveEditColors = [];
        chartData.editData.forEach((val, index) => {
            if (val > 0) {
                positiveEditData.push(val);
                positiveEditLabels.push(chartData.labels[index]);
                positiveEditColors.push(colors[index]);
            }
        });
        const positiveReviewData = [], positiveReviewLabels = [], positiveReviewColors = [];
        chartData.reviewData.forEach((val, index) => {
            if (val > 0) {
                positiveReviewData.push(val);
                positiveReviewLabels.push(chartData.labels[index]);
                positiveReviewColors.push(colors[index]);
            }
        });
        if (editPieChart) {
            editPieChart.data.labels = positiveEditLabels;
            editPieChart.data.datasets[0].data = positiveEditData;
            editPieChart.data.datasets[0].backgroundColor = positiveEditColors;
            editPieChart.update();
        }
        if (reviewPieChart) {
            reviewPieChart.data.labels = positiveReviewLabels;
            reviewPieChart.data.datasets[0].data = positiveReviewData;
            reviewPieChart.data.datasets[0].backgroundColor = positiveReviewColors;
            reviewPieChart.update();
        }
    } else {
        let chartData;
        switch (viewType) {
            case 'monthly':
                chartData = aggregateDataByMonth(filteredData);
                break;
            case 'aggregated':
            case 'total':
            case 'singleMonthProject':
            default:
                chartData = aggregateDataByProject(filteredData);
                break;
        }
        if (mainChart) {
            mainChart.data.labels = chartData.labels;
            mainChart.data.datasets[0].data = chartData.editData;
            mainChart.data.datasets[1].data = chartData.reviewData;
            mainChart.update();
        }
    }
    updateTotals(filteredData);
}

function aggregateDataByMonth(filteredData) {
    const monthlyTotals = {};
    const t = translations[getCurrentLanguage()];
    filteredData.forEach(d => {
        const key = `${d.year}-${String(d.month + 1).padStart(2, '0')}`;
        if (!monthlyTotals[key]) {
            monthlyTotals[key] = { Edit_total: 0, Review_total: 0, label: `${t.months[d.month]} ${d.year}` };
        }
        monthlyTotals[key].Edit_total += d.Edit_total;
        monthlyTotals[key].Review_total += d.Review_total;
    });
    const sortedKeys = Object.keys(monthlyTotals).sort();
    return {
        labels: sortedKeys.map(key => monthlyTotals[key].label),
        editData: sortedKeys.map(key => monthlyTotals[key].Edit_total),
        reviewData: sortedKeys.map(key => monthlyTotals[key].Review_total)
    };
}

function aggregateDataByProject(filteredData) {
    const projectTotals = {};
    filteredData.forEach(d => {
        const key = d.hasOwnProperty('reportName') ? `${d.reportName}-${d.Project}` : d.Project;
        if (!projectTotals[key]) {
            projectTotals[key] = { Edit_total: 0, Review_total: 0, label: d.hasOwnProperty('reportName') ? `${d.Project}` : d.Project };
        }
        projectTotals[key].Edit_total += d.Edit_total;
        projectTotals[key].Review_total += d.Review_total;
    });
    const sortedKeys = Object.keys(projectTotals).sort((a,b) => projectTotals[a].label.localeCompare(projectTotals[b].label));
    return {
        labels: sortedKeys.map(key => projectTotals[key].label),
        editData: sortedKeys.map(key => projectTotals[key].Edit_total),
        reviewData: sortedKeys.map(key => projectTotals[key].Review_total)
    };
}

function renderSidebar(dataToRender = []) {
  const list = document.getElementById("dataList");
  const t = translations[getCurrentLanguage()];
  list.innerHTML = "";
  dataToRender.forEach(d => {
    const total = d.Edit_total + d.Review_total;
    const editPercentage = total > 0 ? (d.Edit_total / total) * 100 : 0;
    const reviewPercentage = total > 0 ? (d.Review_total / total) * 100 : 0;
    const li = document.createElement("li");
    const subHeaderText = d.hasOwnProperty('month')
      ? `(${t.months[d.month]} ${d.year})`
      : `(${t.reportLabel.replace(':', '')}: ${d.reportName})`;
    li.innerHTML = `
      <strong>${d.Project} ${subHeaderText}</strong><br>
      ${t.editLabel}: ${d.Edit_total}, ${t.reviewLabel}: ${d.Review_total}
      <div class="progress-bar-container">
        <div class="progress-bar edit-bar" style="width: ${editPercentage}%;"></div>
        <div class="progress-bar review-bar" style="width: ${reviewPercentage}%;"></div>
      </div>
    `;
    list.appendChild(li);
  });
}

function renderEditorList() {
    const editorList = document.getElementById("editorList");
    const t = translations[getCurrentLanguage()];
    editorList.innerHTML = "";
    const searchTerm = editorSearchTerm.toLowerCase();
    const filteredData = searchTerm
        ? data.filter(d => d.Project.toLowerCase().includes(searchTerm))
        : [...data];
    
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    if (currentPage > totalPages && totalPages > 0) {
        currentPage = totalPages;
    }
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedData = filteredData.slice(startIndex, endIndex);
    
    paginatedData.forEach(item => {
        const originalIndex = data.findIndex(d => d === item);
        const li = document.createElement("li");
        const dateOrReportInfo = item.hasOwnProperty('month')
            ? `<span>${t.months[item.month]} ${item.year}</span>`
            : `<span class="report-name-tag" title="${item.reportName}">${t.reportLabel.replace(':', '')}: ${item.reportName.length > 15 ? item.reportName.substring(0, 15) + '...' : item.reportName}</span>`;
        li.innerHTML = `
          <input type="checkbox" class="row-checkbox" data-index="${originalIndex}">
          <input type="text" value="${item.Project}" onchange="updateProject(${originalIndex}, 'Project', this.value)">
          <input type="number" value="${item.Edit_total}" onchange="updateProject(${originalIndex}, 'Edit_total', this.value)">
          <input type="number" value="${item.Review_total}" onchange="updateProject(${originalIndex}, 'Review_total', this.value)">
          ${dateOrReportInfo}
          <button onclick="removeProject(${originalIndex})">${t.deleteButton.toUpperCase()}</button>
        `;
        editorList.appendChild(li);
    });
    
    document.querySelectorAll('.row-checkbox').forEach(box => {
        box.onchange = updateBatchActionUI;
    });
    renderPaginationControls(filteredData.length);
    updateBatchActionUI();
}

function renderPaginationControls(totalItems) {
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    if (totalPages <= 1) {
        document.getElementById('pagination-controls').style.display = 'none';
        return;
    }
    document.getElementById('pagination-controls').style.display = 'flex';
    const t = translations[getCurrentLanguage()];
    const infoText = t.paginationInfo
                      .replace('%s', currentPage)
                      .replace('%s', totalPages);
    pageInfo.textContent = infoText;
    prevBtn.disabled = currentPage === 1;
    nextBtn.disabled = currentPage === totalPages;
}

document.getElementById('prevPageBtn').addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        renderEditorList();
    }
});
document.getElementById('nextPageBtn').addEventListener('click', () => {
    const searchTerm = editorSearchTerm.toLowerCase();
    const filteredData = searchTerm ? data.filter(d => d.Project.toLowerCase().includes(searchTerm)) : data;
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        renderEditorList();
    }
});

document.getElementById("dataForm").onsubmit = (e) => {
  e.preventDefault();
  const name = document.getElementById("projectName").value.trim();
  const edit = Number(document.getElementById("editValue").value);
  const review = Number(document.getElementById("reviewValue").value);
  const year = Number(document.getElementById("dataYear").value);
  const month = Number(document.getElementById("dataMonth").value);
  const t = translations[getCurrentLanguage()];
  if (!name || isNaN(edit) || isNaN(review) || edit < 0 || review < 0) {
    showToast(t.toastInvalidData, "error");
    return;
  }
  addOrUpdateData({ Project: name, Edit_total: edit, Review_total: review, year, month }, { isManualAdd: true, name: name, month: month, year: year});
  e.target.reset();
  populateDateSelectors('dataYear', 'dataMonth');
  refreshAll();
};

window.updateProject = function(index, field, value) {
  const t = translations[getCurrentLanguage()];
  if (field !== "Project" && (isNaN(Number(value)) || Number(value) < 0)) {
    showToast(t.toastInvalidData, "error");
    refreshAll();
    return;
  }
  data[index][field] = field === "Project" ? value : Number(value);
  refreshAll();
  showToast(t.toastDataUpdated, "info");
};

window.removeProject = function(index) {
  const item = { ...data[index] };
  data.splice(index, 1);
  
  const totalItems = editorSearchTerm ? data.filter(d => d.Project.toLowerCase().includes(editorSearchTerm.toLowerCase())).length : data.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  if (currentPage > totalPages) {
    currentPage = totalPages > 0 ? totalPages : 1;
  }
  
  refreshAll();
  
  const t = translations[getCurrentLanguage()];
  const undoCallback = () => {
    data.splice(index, 0, item);
    refreshAll();
  };

  showUndoToast(t.toastRecordDeleted.replace('%s', item.Project), undoCallback);
};


window.sortData = function(field, buttonElement) {
    if (lastSortField === field) {
        sortDirection *= -1;
    } else {
        sortDirection = 1;
        lastSortField = field;
    }

    const sortFunction = (a, b) => {
        let valA, valB;
        if (field === 'dateOrReport') {
            valA = a.hasOwnProperty('month') ? `${a.year}-${String(a.month).padStart(2, '0')}` : (a.reportName || '');
            valB = b.hasOwnProperty('month') ? `${b.year}-${String(b.month).padStart(2, '0')}` : (b.reportName || '');
            return sortDirection * valA.localeCompare(valB, getCurrentLanguage(), { numeric: true });
        } else {
            valA = a[field];
            valB = b[field];
        }

        if (typeof valA === 'string') {
            return sortDirection * valA.localeCompare(valB, getCurrentLanguage(), { numeric: true });
        }
        return sortDirection * ((valA || 0) - (valB || 0));
    };

    const isSidebar = buttonElement && buttonElement.closest('#sidebar');
    
    if (isSidebar) {
        const dataToSort = [...getFilteredData()];
        dataToSort.sort(sortFunction);
        renderSidebar(dataToSort);
    } else {
        data.sort(sortFunction);
        renderEditorList();
    }
    
    if (buttonElement) {
        const sortButtonsContainer = buttonElement.closest('.sort-buttons');
        sortButtonsContainer.querySelectorAll('.sort-indicator').forEach(ind => {
            ind.className = 'sort-indicator';
        });
        const indicator = buttonElement.querySelector('.sort-indicator');
        if (indicator) {
            indicator.classList.add(sortDirection === 1 ? 'asc' : 'desc');
        }
    }
};

document.getElementById("searchInput").oninput = function(e) {
  const searchTerm = e.target.value.toLowerCase();
  const filtered = getFilteredData().filter(d => d.Project.toLowerCase().includes(searchTerm));
  renderSidebar(filtered);
};

document.getElementById('editorSearchInput').oninput = function(e) {
    editorSearchTerm = e.target.value;
    currentPage = 1;
    renderEditorList();
};

document.getElementById("exportCSVBtn").onclick = function() {
  const datedData = data.filter(d => d.hasOwnProperty('month'));
  const header = "Project,Edit,Review,Month,Year\n";
  const csv = datedData.map(d => `"${d.Project}",${d.Edit_total},${d.Review_total},${d.month + 1},${d.year}`).join("\n");
  const blob = new Blob([header + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "transifex-report-monthly.csv";
  a.click();
  URL.revokeObjectURL(url);
};

document.getElementById("csvFile").onchange = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    pendingCsvFile = file;
    const reader = new FileReader();
    reader.onload = function(ev) {
        const headerLine = (ev.target.result.split("\n")[0] || "").toLowerCase().trim();
        const hasDateColumns = headerLine.includes("month") && headerLine.includes("year");
        if (hasDateColumns) {
            processCsvFile({ isMultiMonth: true });
        } else {
            document.getElementById('csvImportTypeModal').style.display = 'flex';
            overlay.classList.add("show");
        }
    };
    reader.readAsText(file);
    e.target.value = '';
};

function processCsvFile(options = {}) {
    if (!pendingCsvFile) return;
    const t = translations[getCurrentLanguage()];
    const reader = new FileReader();
    reader.onload = function(ev) {
        try {
            const csvData = ev.target.result;
            if (options.isMultiMonth) {
                const parsedData = parseMultiMonthCSV(csvData);
                if (parsedData.length === 0) { showToast(t.toastCsvError, "error"); return; }
                parsedData.forEach(row => addOrUpdateData(row));
                showToast(t.toastCsvMultiMonthImported.replace('%d', parsedData.length).replace('%s', pendingCsvFile.name), "success");
            } else {
                const parsedData = parseSummaryCSV(csvData);
                if (parsedData.length === 0) { showToast(t.toastCsvError, "error"); return; }
                if (options.reportName) {
                    parsedData.forEach(row => data.push({ ...row, reportName: options.reportName }));
                    showToast(t.toastAggregatedReportImported.replace('%s', options.reportName).replace('%d', parsedData.length), "success");
                } else { 
                    parsedData.forEach(row => addOrUpdateData({ ...row, month: options.month, year: options.year }));
                    showToast(t.toastCsvImported.replace('%s', `"${pendingCsvFile.name}"`), "success");
                }
            }
            refreshAll();
        } catch (err) {
            showToast(err.message || t.toastCsvError, "error");
        } finally {
            pendingCsvFile = null;
        }
    };
    reader.readAsText(pendingCsvFile);
}

document.getElementById('csvImportSingleDateBtn').onclick = () => {
    document.getElementById('csvImportTypeModal').style.display = 'none';
    document.getElementById('csvDateModal').style.display = 'flex';
};
document.getElementById('csvImportAggregatedBtn').onclick = () => {
    document.getElementById('csvImportTypeModal').style.display = 'none';
    overlay.classList.remove("show");
    const t = translations[getCurrentLanguage()];
    const reportName = prompt(t.promptReportName);
    if (reportName) {
        processCsvFile({ reportName: reportName });
    }
};
document.getElementById('csvImportCancelBtn').onclick = () => {
    document.getElementById('csvImportTypeModal').style.display = 'none';
    overlay.classList.remove("show");
    pendingCsvFile = null;
};
document.getElementById('confirmCsvDate').onclick = () => {
    const year = parseInt(document.getElementById('csvYear').value);
    const month = parseInt(document.getElementById('csvMonth').value);
    processCsvFile({ month, year });
    document.getElementById('csvDateModal').style.display = 'none';
    overlay.classList.remove("show");
};
document.getElementById('cancelCsvDate').onclick = () => {
    document.getElementById('csvDateModal').style.display = 'none';
    overlay.classList.remove("show");
    pendingCsvFile = null;
};

function addOrUpdateData(item, options = {}) {
    const { Project, Edit_total, Review_total, year, month } = item;
    const t = translations[getCurrentLanguage()];
    const existingIndex = data.findIndex(d => d.Project === Project && d.year === year && d.month === month);
    if (existingIndex > -1) {
        if (options.isManualAdd) {
            const monthName = t.months[month];
            const confirmMessage = t.confirmUpdate.replace('%s', options.name).replace('%s', monthName).replace('%s', options.year);
            if (confirm(confirmMessage)) {
                data[existingIndex].Edit_total = Edit_total;
                data[existingIndex].Review_total = Review_total;
                showToast(t.toastDataUpdated, "info");
            } else {
                data[existingIndex].Edit_total += Edit_total;
                data[existingIndex].Review_total += Review_total;
                showToast(t.toastDataAdded, "success");
            }
        } else {
            data[existingIndex].Edit_total += Edit_total;
            data[existingIndex].Review_total += Review_total;
        }
    } else {
        data.push(item);
        if (options.isManualAdd) {
             showToast(t.toastProjectAdded.replace('%s', Project), "success");
        }
    }
}

function parseMultiMonthCSV(csv) {
    const t = translations[getCurrentLanguage()];
    const rows = csv.split("\n");
    const header = rows[0].trim().toLowerCase().split(",").map(h => h.replace(/"/g, ''));
    if (!['project', 'edit', 'review', 'month', 'year'].every(col => header.includes(col))) {
        throw new Error(t.toastCsvInvalidMultiMonthFormat);
    }
    const pIdx = header.indexOf('project'), eIdx = header.indexOf('edit'), rIdx = header.indexOf('review'), mIdx = header.indexOf('month'), yIdx = header.indexOf('year');
    const result = [];
    for (let i = 1; i < rows.length; i++) {
        if (rows[i].trim() === '') continue;
        const cols = rows[i].split(",");
        const pName = cols[pIdx]?.trim().replace(/"/g, ''), ed = parseInt(cols[eIdx], 10), rev = parseInt(cols[rIdx], 10), m = parseInt(cols[mIdx], 10) - 1, y = parseInt(cols[yIdx], 10);
        if (pName && !isNaN(ed) && !isNaN(rev) && !isNaN(m) && !isNaN(y) && m >= 0 && m <= 11) {
            result.push({ Project: pName, Edit_total: ed, Review_total: rev, month: m, year: y });
        }
    }
    return result;
}

function parseSummaryCSV(csv) {
    const rows = csv.split("\n").slice(1);
    const result = [];
    rows.forEach(row => {
        const cols = row.split(",").map(c => c.trim().replace(/"/g, ''));
        if (cols.length < 2) return;
        let projectName, editTotal, reviewTotal;
        if (cols.length >= 17 && !isNaN(parseInt(cols[15],10))) {
            projectName = cols[1];
            editTotal = parseInt(cols[15], 10);
            reviewTotal = parseInt(cols[16], 10);
        } else {
            projectName = cols[0];
            editTotal = parseInt(cols[1], 10);
            reviewTotal = parseInt(cols[2], 10);
        }
        if (projectName && !isNaN(editTotal) && !isNaN(reviewTotal)) {
            result.push({ Project: projectName, Edit_total: editTotal, Review_total: reviewTotal });
        }
    });
    return result;
}

const defaultEditColor = localStorage.getItem("editColor") || "#10b981";
const defaultReviewColor = localStorage.getItem("reviewColor") || "#ea580c";

function generateDistinctColors(count) {
    const colors = [];
    if (count === 0) return colors;
    const hueStep = 360 / count;
    for (let i = 0; i < count; i++) {
        const hue = i * hueStep;
        colors.push(`hsl(${hue}, 70%, 60%)`);
    }
    return colors;
}

function destroyCharts() {
    if (mainChart) mainChart.destroy();
    if (editPieChart) editPieChart.destroy();
    if (reviewPieChart) reviewPieChart.destroy();
    mainChart = null;
    editPieChart = null;
    reviewPieChart = null;
}

function createChart(type) {
    destroyCharts();
    const mainContainer = document.getElementById('mainChartContainer');
    const pieContainer = document.getElementById('pieChartContainer');
    const t = translations[getCurrentLanguage()];

    const animationOptions = {
        onComplete: () => {
            isChartAnimating = false;
        }
    };

    if (type === 'pie') {
        mainContainer.style.display = 'none';
        pieContainer.style.display = 'flex';
        document.getElementById('editPieTitle').textContent = t.editPieChartTitle;
        document.getElementById('reviewPieTitle').textContent = t.reviewPieChartTitle;
        const pieOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'right', labels: { color: getTextColor() } } },
            animation: animationOptions
        };
        editPieChart = new Chart(document.getElementById('editPieChart').getContext('2d'), {
            type: 'pie', data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] }, options: pieOptions
        });
        reviewPieChart = new Chart(document.getElementById('reviewPieChart').getContext('2d'), {
            type: 'pie', data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] }, options: pieOptions
        });
    } else {
        mainContainer.style.display = 'block';
        pieContainer.style.display = 'none';
        const chartType = (type === 'stacked') ? 'bar' : type;
        const isStacked = type === 'stacked';
        const options = {
            responsive: true,
            plugins: { legend: { position: 'bottom', labels: { color: getTextColor() } }, zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } } },
            scales: {
                x: { ticks: { color: getTextColor(), maxRotation: 45, minRotation: 45 }, stacked: isStacked },
                y: { ticks: { color: getTextColor() }, beginAtZero: true, stacked: isStacked }
            },
            animation: animationOptions
        };
        mainChart = new Chart(document.getElementById('myChart').getContext('2d'), {
            type: chartType,
            data: {
                labels: [],
                datasets: [
                    { label: t.editLabel, data: [], backgroundColor: chartType === 'bar' ? defaultEditColor : 'transparent', borderColor: defaultEditColor, borderWidth: chartType === 'line' ? 3 : 1 },
                    { label: t.reviewLabel, data: [], backgroundColor: chartType === 'bar' ? defaultReviewColor : 'transparent', borderColor: defaultReviewColor, borderWidth: chartType === 'line' ? 3 : 1 }
                ]
            },
            options: options
        });
    }
}

document.getElementById("chartTypeSelect").onchange = function(e) {
  const newType = e.target.value;
  const t = translations[getCurrentLanguage()];
  const selectedOption = e.target.options[e.target.selectedIndex];
  const chartTypeName = selectedOption.textContent;
  createChart(newType);
  applyColors();
  applyFiltersAndRender();
  showToast(t.toastChartTypeChanged.replace('%s', chartTypeName), "info");
};

document.getElementById("resetZoom").onclick = () => {
    if(mainChart) {
        mainChart.resetZoom();
        const t = translations[getCurrentLanguage()];
        showToast(t.toastChartReset, "info");
    }
}

function populateAggregatedReportSelector() {
    const selector = document.getElementById('aggregatedReportSelector');
    const aggregatedReports = [...new Set(data.filter(d => d.hasOwnProperty('reportName')).map(d => d.reportName))];
    selector.innerHTML = '';
    aggregatedReports.forEach(name => {
        selector.add(new Option(name, name));
    });
}

function toggleFilterVisibility() {
    const viewType = document.getElementById('viewType').value;
    const rangeFilter = document.getElementById('filter-group-range');
    const singleFilter = document.getElementById('filter-group-single');
    const aggregatedFilter = document.getElementById('filter-group-aggregated');
    rangeFilter.style.display = 'none';
    singleFilter.style.display = 'none';
    aggregatedFilter.style.display = 'none';
    if (viewType === 'singleMonthProject') {
        singleFilter.style.display = 'flex';
    } else if (viewType === 'aggregated') {
        aggregatedFilter.style.display = 'flex';
        populateAggregatedReportSelector();
    } else {
        rangeFilter.style.display = 'flex';
    }
}

document.getElementById('clearFilterBtn').onclick = () => {
    document.getElementById('viewType').value = 'total';
    populateFilterDateSelectors(true);
    toggleFilterVisibility(); 
    applyFiltersAndRender();
};

document.getElementById('viewType').onchange = () => {
    toggleFilterVisibility();
    applyFiltersAndRender();
};

['startMonth', 'startYear', 'endMonth', 'endYear', 'singleMonth', 'singleYear'].forEach(id => {
    document.getElementById(id).onchange = applyFiltersAndRender;
});

function populateFilterDateSelectors(reset = false) {
    const datedData = data.filter(d => d.hasOwnProperty('month'));
    let availableYears = [...new Set(datedData.map(d => d.year))].sort((a, b) => a - b);
    const currentFullYear = new Date().getFullYear();
    if (!availableYears.includes(currentFullYear)) {
        availableYears.push(currentFullYear);
        availableYears.sort((a,b) => a-b);
    }
    if (availableYears.length === 0) availableYears.push(currentFullYear);
    const selectors = ['startYear', 'endYear', 'singleYear', 'dataYear', 'csvYear'];
    const t = translations[getCurrentLanguage()];
    selectors.forEach(selId => {
        const ySel = document.getElementById(selId), mSel = document.getElementById(selId.replace('Year', 'Month'));
        if (!ySel || !mSel) return;
        const sY = ySel.value, sM = mSel.value;
        ySel.innerHTML = ''; mSel.innerHTML = '';
        availableYears.forEach(y => ySel.add(new Option(y, y)));
        t.months.forEach((m, i) => mSel.add(new Option(m, i)));
        if (reset || !sY || !ySel.querySelector(`option[value="${sY}"]`)) {
            if (selId.includes('start')) { ySel.value = availableYears[0]; mSel.value = 0; }
            else { 
                ySel.value = availableYears[availableYears.length - 1]; 
                mSel.value = selId.includes('end') ? 11 : new Date().getMonth(); 
            }
        } else { ySel.value = sY; mSel.value = sM; }
    });
}

document.getElementById("toggleTheme").onclick = () => {
  document.body.classList.toggle("dark");
  applyTranslations();
  const textColor = getTextColor();
  if (mainChart) {
    mainChart.options.scales.x.ticks.color = textColor;
    mainChart.options.scales.y.ticks.color = textColor;
    mainChart.options.plugins.legend.labels.color = textColor;
    mainChart.update();
  }
  if (editPieChart) {
    editPieChart.options.plugins.legend.labels.color = textColor;
    editPieChart.update();
  }
  if (reviewPieChart) {
    reviewPieChart.options.plugins.legend.labels.color = textColor;
    reviewPieChart.update();
  }
};

function applyColors() {
    const editColor = document.getElementById("editColor").value;
    const reviewColor = document.getElementById("reviewColor").value;
    document.body.style.setProperty('--edit-color', editColor);
    document.body.style.setProperty('--review-color', reviewColor);
    document.querySelector(".total-box.edit").style.background = editColor + "33";
    document.querySelector(".total-box.edit").style.color = editColor;
    document.querySelector(".total-box.review").style.background = reviewColor + "33";
    document.querySelector(".total-box.review").style.color = reviewColor;
    if (mainChart) {
        const type = mainChart.config.type;
        mainChart.data.datasets[0].backgroundColor = type === 'bar' ? editColor : 'transparent';
        mainChart.data.datasets[0].borderColor = editColor;
        mainChart.data.datasets[1].backgroundColor = type === 'bar' ? reviewColor : 'transparent';
        mainChart.data.datasets[1].borderColor = reviewColor;
        mainChart.update();
    }
}

document.getElementById("editColor").value = defaultEditColor;
document.getElementById("reviewColor").value = defaultReviewColor;
document.getElementById("saveColors").onclick = () => {
  localStorage.setItem("editColor", document.getElementById("editColor").value);
  localStorage.setItem("reviewColor", document.getElementById("reviewColor").value);
  applyColors();
  const t = translations[getCurrentLanguage()];
  showToast(t.toastColorsSaved, "success");
};

const popups = {
    sidebar: document.getElementById("sidebar"),
    editor: document.getElementById("editorPopup"),
    settings: document.getElementById("settingsPopup"),
    csvType: document.getElementById("csvImportTypeModal"),
    csvDate: document.getElementById("csvDateModal"),
    filterInfo: document.getElementById("filterInfoModal"),
    confirmLoad: document.getElementById("confirmLoadModal"),
    overlay: document.getElementById("overlay")
};

function closeAllPopups() {
    for (const key in popups) {
        if(key === 'sidebar') popups[key].classList.remove("open");
        else if (key !== 'overlay') popups[key].style.display = 'none';
    }
    popups.overlay.classList.remove("show");
}

document.getElementById("openSidebar").onclick = () => { closeAllPopups(); renderSidebar(getFilteredData()); popups.sidebar.classList.add("open"); popups.overlay.classList.add("show"); };
document.getElementById("openSettings").onclick = () => { closeAllPopups(); popups.settings.style.display = 'block'; popups.overlay.classList.add("show"); };

document.getElementById("openEditorFromSettings").onclick = () => { 
    closeAllPopups(); 
    currentPage = 1; 
    editorSearchTerm = '';
    document.getElementById('editorSearchInput').value = '';
    renderEditorList(); 
    
    document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    
    document.getElementById('tab-manualEntry').style.display = 'block';
    document.querySelector('.tab-btn[onclick*="manualEntry"]').classList.add('active');
    
    popups.editor.style.display = 'block'; 
    popups.overlay.classList.add("show"); 
};

document.getElementById('filterInfoBtn').onclick = () => {
    const t = translations[getCurrentLanguage()];
    document.getElementById('filterInfoTitle').textContent = t.filterInfoTitle;
    const contentDiv = document.getElementById('filterInfoContent');
    contentDiv.innerHTML = '';
    const ul = document.createElement('ul');
    const infoItems = t.filterInfoText.split('\n');
    infoItems.forEach(itemText => {
        const li = document.createElement('li');
        const parts = itemText.split(':');
        const strong = document.createElement('strong');
        strong.textContent = parts[0].replace('• ','').trim() + ':';
        li.appendChild(strong);
        li.append(parts.slice(1).join(':').trim());
        ul.appendChild(li);
    });
    contentDiv.appendChild(ul);
    closeAllPopups(); 
    popups.filterInfo.style.display = 'flex'; 
    popups.overlay.classList.add("show");
};

document.getElementById("closeSidebar").onclick = closeAllPopups;
document.getElementById("closeSettings").onclick = closeAllPopups;
document.getElementById("closeEditor").onclick = closeAllPopups;
document.getElementById("closeFilterInfo").onclick = closeAllPopups;
document.getElementById("closeConfirmLoadModal").onclick = () => {
    closeAllPopups();
    document.getElementById('loadSelect').value = '';
    pendingLoadName = null;
};
popups.overlay.onclick = closeAllPopups;

window.openEditorTab = function(event, tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).style.display = 'block';
    if(event.currentTarget) event.currentTarget.classList.add('active');
}

function getHighResChartImage(chart) {
    if (!chart) return null;
    
    const scaleFactor = 2;
    const fontBoost = 1.3;
    const scaledWidth = chart.width * scaleFactor;
    const scaledHeight = chart.height * scaleFactor;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = scaledWidth;
    tempCanvas.height = scaledHeight;
    const tempCtx = tempCanvas.getContext('2d');

    const clonedOptions = JSON.parse(JSON.stringify(chart.options));
    clonedOptions.responsive = false;
    clonedOptions.animation = false;
    clonedOptions.devicePixelRatio = scaleFactor;

    if (clonedOptions.scales) {
        Object.keys(clonedOptions.scales).forEach(key => {
            if (clonedOptions.scales[key].ticks) {
                const origSize = clonedOptions.scales[key].ticks.font?.size || 12;
                clonedOptions.scales[key].ticks.font = {
                    ...clonedOptions.scales[key].ticks.font,
                    size: origSize * scaleFactor * fontBoost
                };
            }
        });
    }
    if (clonedOptions.plugins?.legend?.labels) {
        const origSize = clonedOptions.plugins.legend.labels.font?.size || 12;
        clonedOptions.plugins.legend.labels.font = {
            ...clonedOptions.plugins.legend.labels.font,
            size: origSize * scaleFactor * fontBoost
        };
    }
    if (clonedOptions.plugins?.title) {
        const origSize = clonedOptions.plugins.title.font?.size || 14;
        clonedOptions.plugins.title.font = {
            ...clonedOptions.plugins.title.font,
            size: origSize * scaleFactor * fontBoost
        };
    }

    const tempChart = new Chart(tempCtx, {
        type: chart.config.type,
        data: chart.data,
        options: {
            ...clonedOptions,
            plugins: {
                ...clonedOptions.plugins,
                legend: {
                    ...clonedOptions.plugins?.legend,
                    labels: {
                        ...clonedOptions.plugins?.legend?.labels,
                        color: '#000'
                    }
                }
            }
        }
    });

    if (tempChart.options.scales) {
        Object.keys(tempChart.options.scales).forEach(key => {
            if (tempChart.options.scales[key].ticks) {
                tempChart.options.scales[key].ticks.color = '#000';
            }
        });
    }
    
    tempChart.resize(scaledWidth, scaledHeight);
    tempChart.update();
    const dataUrl = tempChart.toBase64Image('image/png', 1.0);
    tempChart.destroy();
    
    return dataUrl;
}

function prepareAndPrintChart() {
    const t = translations[getCurrentLanguage()];

    if (isChartAnimating) {
        showToast(t.toastChartAnimating, 'warning');
        return;
    }

    const printTitle = document.getElementById('printTitle');
    const printCharts = document.getElementById('printCharts');
    const printTableContainer = document.getElementById('printTableContainer');

    printCharts.innerHTML = '';
    printTableContainer.innerHTML = '';
    printTitle.textContent = t.printReportTitle;

    const chartType = document.getElementById('chartTypeSelect').value;
    
    if (chartType === 'pie') {
        if (editPieChart && reviewPieChart) {
            const editImg = document.createElement('img');
            editImg.src = getHighResChartImage(editPieChart);
            printCharts.appendChild(editImg);

            const reviewImg = document.createElement('img');
            reviewImg.src = getHighResChartImage(reviewPieChart);
            printCharts.appendChild(reviewImg);
        }
    } else {
        if (mainChart) {
            const mainImg = document.createElement('img');
            mainImg.src = getHighResChartImage(mainChart);
            printCharts.appendChild(mainImg);
        }
    }

    const filteredData = getFilteredData();
    const viewType = document.getElementById('viewType').value;

    let tableData;
    let labels;

    switch (viewType) {
        case 'monthly':
            tableData = aggregateDataByMonth(filteredData);
            break;
        case 'aggregated':
        case 'total':
        case 'singleMonthProject':
        default:
            tableData = aggregateDataByProject(filteredData);
            break;
    }
    
    labels = tableData.labels;

    if (!tableData || !labels || labels.length === 0) {
        printTableContainer.innerHTML = `<p>${t.toastNoAggregatedData}</p>`;
        window.print();
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    const headerRow = document.createElement('tr');
    const projectHeader = (viewType === 'monthly') ? t.tableHeaderDate.replace(' / rapor', '') : t.printProjectHeader;
    headerRow.innerHTML = `<th>${projectHeader}</th><th>${t.printEditHeader}</th><th>${t.printReviewHeader}</th>`;
    thead.appendChild(headerRow);

    let totalEdit = 0;
    let totalReview = 0;

    for (let i = 0; i < labels.length; i++) {
        const row = document.createElement('tr');
        const editValue = tableData.editData[i] || 0;
        const reviewValue = tableData.reviewData[i] || 0;
        totalEdit += editValue;
        totalReview += reviewValue;
        
        row.innerHTML = `<td>${labels[i]}</td><td>${editValue}</td><td>${reviewValue}</td>`;
        tbody.appendChild(row);
    }
    
    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row'; 
    totalRow.innerHTML = `<td class="total-label">${t.printGrandTotal}</td><td>${totalEdit}</td><td>${totalReview}</td>`;
    tbody.appendChild(totalRow);

    table.appendChild(thead);
    table.appendChild(tbody);
    printTableContainer.appendChild(table);

    setTimeout(() => {
        window.print();
    }, 250);
}


function saveDataWithName() {
  const t = translations[getCurrentLanguage()];
  const name = prompt(t.promptSaveName, "New Record");
  if (!name) return;
  localStorage.setItem("chartData_" + name, JSON.stringify(data));
  renderSavedOptions();
  showToast(t.toastRecordSaved.replace('%s', `"${name}"`), "success");
}
function loadDataByName(name, silent = false) {
  const raw = localStorage.getItem("chartData_" + name);
  if (!raw) return;
  data = JSON.parse(raw);
  currentPage = 1;
  refreshAll();
  const t = translations[getCurrentLanguage()];
  if (!silent) {
    showToast(t.toastRecordLoaded.replace('%s', `"${name}"`), "success");
  }
}
function renderSavedOptions() {
  const loadSelect = document.getElementById("loadSelect");
  const t = translations[getCurrentLanguage()];
  loadSelect.innerHTML = `<option value="">${t.selectRecord}</option>`;
  Object.keys(localStorage).filter(k => k.startsWith("chartData_")).sort().forEach(k => {
    const name = k.replace("chartData_", "");
    loadSelect.add(new Option(name, name));
  });
}
document.getElementById("saveDataBtn").onclick = saveDataWithName;

document.getElementById("loadSelect").onchange = function() {
    const selectedValue = this.value;
    if (!selectedValue) return;

    pendingLoadName = selectedValue;
    popups.confirmLoad.style.display = 'flex';
    popups.overlay.classList.add('show');
    applyTranslations();
    
    this.value = '';
};

document.getElementById("overwriteDataBtn").onclick = () => {
  const selected = document.getElementById("loadSelect").value;
  const t = translations[getCurrentLanguage()];
  if (!selected) return showToast(t.toastRecordSelected, "error");

  const originalDataJSON = localStorage.getItem("chartData_" + selected);
  localStorage.setItem("chartData_" + selected, JSON.stringify(data));

  const undoCallback = () => {
      localStorage.setItem("chartData_" + selected, originalDataJSON);
      if (document.getElementById("loadSelect").value === selected) {
          loadDataByName(selected, true);
      }
  };

  showUndoToast(t.toastRecordOverwritten.replace('%s', `"${selected}"`), undoCallback);
};
document.getElementById("renameSelectedBtn").onclick = () => {
  const selected = document.getElementById("loadSelect").value;
  const t = translations[getCurrentLanguage()];
  if (!selected) return showToast(t.toastRecordSelected, "error");
  const newName = prompt(t.promptNewName, selected);
  if (!newName || newName === selected) return;
  const raw = localStorage.getItem("chartData_" + selected);
  localStorage.removeItem("chartData_" + selected);
  localStorage.setItem("chartData_" + newName, raw);
  renderSavedOptions();
  document.getElementById("loadSelect").value = newName;
  showToast(t.toastRecordRenamed.replace('%s', `"${selected}"`).replace('%s', `"${newName}"`), "success");
};
document.getElementById("exportSelectedBtn").onclick = () => {
  const selected = document.getElementById("loadSelect").value;
  const t = translations[getCurrentLanguage()];
  if (!selected) return showToast(t.toastRecordSelected, "error");
  const raw = localStorage.getItem("chartData_" + selected);
  if (!raw) return;
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = selected + ".json";
  a.click();
  URL.revokeObjectURL(url);
  showToast(t.toastRecordExported.replace('%s', `"${selected}"`), "success");
};
document.getElementById("importFile").onchange = function(e) {
  const file = e.target.files[0];
  const t = translations[getCurrentLanguage()];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const importedData = JSON.parse(ev.target.result);
      const name = prompt(t.promptSaveName, file.name.replace(".json", ""));
      if (!name) return;
      localStorage.setItem("chartData_" + name, JSON.stringify(importedData));
      renderSavedOptions();
      document.getElementById("loadSelect").value = name;
      data = importedData;
      currentPage = 1;
      refreshAll();
      showToast(t.toastFileImported.replace('%s', `"${name}"`), "success");
    } catch (err) {
      showToast(t.toastInvalidFile, "error");
    }
  };
  reader.readAsText(file);
};
document.getElementById("deleteSelectedBtn").onclick = () => {
  const selected = document.getElementById("loadSelect").value;
  const t = translations[getCurrentLanguage()];
  if (!selected) return showToast(t.toastRecordSelected, "error");
  if (confirm(t.confirmDeleteRecord.replace('%s', `"${selected}"`))) {
    const originalDataJSON = localStorage.getItem("chartData_" + selected);
    localStorage.removeItem("chartData_" + selected);
    renderSavedOptions();

    const undoCallback = () => {
        localStorage.setItem("chartData_" + selected, originalDataJSON);
        renderSavedOptions();
        document.getElementById("loadSelect").value = selected;
    };
    
    showUndoToast(t.toastRecordDeleted.replace('%s', selected), undoCallback);
  }
};
document.getElementById("clearDataBtn").onclick = () => {
  const t = translations[getCurrentLanguage()];
  if (confirm(t.confirmDeleteAllRecords)) {
    const backup = {};
    Object.keys(localStorage).forEach(k => { 
        if (k.startsWith("chartData_")) {
            backup[k] = localStorage.getItem(k);
            localStorage.removeItem(k); 
        }
    });
    renderSavedOptions();

    const undoCallback = () => {
        Object.keys(backup).forEach(k => {
            localStorage.setItem(k, backup[k]);
        });
        renderSavedOptions();
    };

    showUndoToast(t.toastAllRecordsDeleted, undoCallback);
  }
};

function updateBatchActionUI() {
    const container = document.getElementById('batchActionContainer');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const checkboxes = document.querySelectorAll('.row-checkbox');
    const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
    if (checkedBoxes.length > 0) {
        container.style.display = 'flex';
    } else {
        container.style.display = 'none';
    }
    selectAllCheckbox.checked = checkboxes.length > 0 && checkedBoxes.length === checkboxes.length;
}

document.getElementById('selectAllCheckbox').onchange = function(e) {
    document.querySelectorAll('.row-checkbox').forEach(box => {
        box.checked = e.target.checked;
    });
    updateBatchActionUI();
};

document.getElementById('deleteSelectedRowsBtn').onclick = function() {
    const t = translations[getCurrentLanguage()];
    const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
    if (checkedBoxes.length === 0) return;

    if (confirm(t.confirmDeleteSelected.replace('%d', checkedBoxes.length))) {
        const indicesToDelete = Array.from(checkedBoxes)
            .map(box => parseInt(box.dataset.index))
            .sort((a, b) => a - b);
        
        const deletedItems = indicesToDelete.map(index => ({ index, item: data[index] }));

        indicesToDelete.reverse().forEach(index => {
            data.splice(index, 1);
        });

        const totalItems = editorSearchTerm ? data.filter(d => d.Project.toLowerCase().includes(editorSearchTerm.toLowerCase())).length : data.length;
        const totalPages = Math.ceil(totalItems / itemsPerPage);
        if (currentPage > totalPages) {
            currentPage = totalPages > 0 ? totalPages : 1;
        }

        refreshAll();

        const undoCallback = () => {
            deletedItems.forEach(deleted => {
                data.splice(deleted.index, 0, deleted.item);
            });
            refreshAll();
        };

        showUndoToast(t.toastRecordsDeleted.replace('%d', checkedBoxes.length), undoCallback);
    }
};

function initializeApp() {
    const langSelector = document.getElementById('languageSelector');
    const languageMap = { ar: 'العربية', 'zh-CN': '简体中文', 'zh-TW': '繁體中文', nl: 'Nederlands', en: 'English', fr: 'Français', de: 'Deutsch', id: 'Bahasa Indonesia', it: 'Italiano', ja: '日本語', ko: '한국어', pl: 'Polski', pt: 'Português', ro: 'Română', ru: 'Русский', es: 'Español', th: 'ไทย', tr: 'Türkçe', vi: 'Tiếng Việt' };
    for (const [code, name] of Object.entries(languageMap)) {
        langSelector.add(new Option(name, code));
    }
    langSelector.value = getCurrentLanguage();
    langSelector.onchange = (e) => {
        saveLanguage(e.target.value);
        location.reload();
    };
    document.getElementById('aggregatedReportSelector').onchange = applyFiltersAndRender;
    document.getElementById('printChartBtn').addEventListener('click', prepareAndPrintChart);
    
    document.getElementById('confirmLoadBtn').onclick = () => {
        if (pendingLoadName) {
            loadDataByName(pendingLoadName);
            document.getElementById('loadSelect').value = pendingLoadName;
        }
        closeAllPopups();
        pendingLoadName = null;
    };
    document.getElementById('exportAndContinueBtn').onclick = () => {
        document.getElementById('exportCSVBtn').click();
    };

    populateDateSelectors('dataYear', 'dataMonth');
    populateDateSelectors('csvYear', 'csvMonth');
    createChart(document.getElementById('chartTypeSelect').value || 'bar');
    applyColors();
    refreshAll();
    renderSavedOptions();
    toggleFilterVisibility();
    applyTranslations();
}

initializeApp();