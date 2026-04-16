import React, { useMemo, useState } from 'react';
import FileUpload from './components/FileUpload';
import Dashboard from './components/Dashboard';
import { History, Table2, X } from 'lucide-react';
import { deleteDataset, listDatasets, listHistory, loadMonth, saveMonth, uploadFiles } from './api';
import './App.css';

import logo from './assets/logo.png';

const MONTH_ORDER = {
  January: 0,
  February: 1,
  March: 2,
  April: 3,
  May: 4,
  June: 5,
  July: 6,
  August: 7,
  September: 8,
  October: 9,
  November: 10,
  December: 11,
};

const parseMonthLabel = (value) => {
  if (!value) return null;

  const match = value.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;

  const monthName = match[1];
  const year = Number(match[2]);
  const monthIndex = MONTH_ORDER[monthName];

  if (monthIndex === undefined || Number.isNaN(year)) {
    return null;
  }

  return { monthName, year, monthIndex };
};

const getPreviousMonthLabel = (month) => {
  const parsed = parseMonthLabel(month);
  if (!parsed) return null;

  if (parsed.monthIndex === 0) {
    return `December ${parsed.year - 1}`;
  }

  const previousMonthName = Object.keys(MONTH_ORDER).find(
    (monthName) => MONTH_ORDER[monthName] === parsed.monthIndex - 1
  );

  return previousMonthName ? `${previousMonthName} ${parsed.year}` : null;
};

const extractMonthFromFilename = (filename) => {
  if (!filename) return "";

  const match = String(filename).match(/(\d{4})-(\d{2})/);
  if (!match) return "";

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const monthName = Object.keys(MONTH_ORDER).find(
    (candidate) => MONTH_ORDER[candidate] === monthNumber - 1
  );

  return monthName ? `${monthName} ${year}` : "";
};

const buildDisplayVersion = (dataset) => {
  const version = dataset?.version || "";
  const month = dataset?.month || "";

  if (!version) {
    return month || "-";
  }

  if (version.startsWith(`${month} - `)) {
    return month;
  }

  return version;
};

function App() {
  const [data, setData] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);

  const [datasets, setDatasets] = useState([]);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [currentDatasetMeta, setCurrentDatasetMeta] = useState(null);
  const [previousMonthData, setPreviousMonthData] = useState([]);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState("");

  const currentMonth = useMemo(() => {
    if (currentDatasetMeta?.month) {
      return currentDatasetMeta.month;
    }

    for (const row of data) {
      const monthFromFilename = extractMonthFromFilename(row?.Filename);
      if (monthFromFilename) {
        return monthFromFilename;
      }
    }

    return "";
  }, [currentDatasetMeta, data]);

  const visibleDatasets = useMemo(() => {
    return [...datasets].sort((left, right) => right.savedAt.localeCompare(left.savedAt));
  }, [datasets]);

  React.useEffect(() => {
    const loadInitialState = async () => {
      await Promise.all([refreshDatasets(), refreshHistory()]);
    };

    loadInitialState();
  }, []);

  const refreshDatasets = async () => {
    try {
      const datasetsRes = await listDatasets();
      if (datasetsRes?.datasets) {
        setDatasets(datasetsRes.datasets);
      }
    } catch (e) {
      console.error("Failed to load saved datasets", e);
    }
  };

  const refreshHistory = async () => {
    try {
      const res = await listHistory();
      if (res?.history) {
        setHistoryEntries(res.history);
      }
    } catch (e) {
      console.error("Failed to load history log", e);
    }
  };

  const handleUpload = async (files) => {
    setIsProcessing(true);
    setError(null);
    try {
      const result = await uploadFiles(files);
      if (result.data) {
        setData(result.data);
        setCurrentDatasetMeta(null);
        setSelectedDatasetId("");

        const detectedMonth = extractMonthFromFilename(result.data[0]?.Filename);
        if (detectedMonth) {
          await loadPreviousMonthData(detectedMonth);
        } else {
          setPreviousMonthData([]);
        }
      }
    } catch {
      setError("Failed to process files. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const loadPreviousMonthData = async (month) => {
    const previousMonth = getPreviousMonthLabel(month);

    if (!previousMonth) {
      setPreviousMonthData([]);
      return;
    }

    const candidateDatasets = datasets
      .filter((dataset) => dataset.month === previousMonth)
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt));

    if (!candidateDatasets.length) {
      setPreviousMonthData([]);
      return;
    }

    try {
      const res = await loadMonth(candidateDatasets[0].id);
      setPreviousMonthData(Array.isArray(res?.data) ? res.data : []);
    } catch (e) {
      console.error("Failed to load previous month data", e);
      setPreviousMonthData([]);
    }
  };

  const handleSave = async () => {
    if (!currentMonth) {
      alert("Could not determine the current month from the loaded data.");
      return;
    }

    if (!data.length) {
      alert("No data loaded to save.");
      return;
    }

    const hasExistingMonth = datasets.some((dataset) => dataset.month === currentMonth);
    if (hasExistingMonth && !window.confirm("Overwrite existing data?")) {
      return;
    }

    setIsSaving(true);
    try {
      const saved = await saveMonth(currentMonth, data);
      await Promise.all([refreshDatasets(), refreshHistory()]);
      setCurrentDatasetMeta(saved);
      setSelectedDatasetId(saved?.id || "");
      await loadPreviousMonthData(currentMonth);
      alert(`Saved ${saved?.version || currentMonth} successfully!`);
    } catch {
      alert("Failed to save data.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoad = async (datasetId) => {
    if (!datasetId) return;
    try {
      const res = await loadMonth(datasetId);
      if (res.data) {
        setData(res.data);
      }
      if (res.metadata) {
        setCurrentDatasetMeta(res.metadata);
        setSelectedDatasetId(res.metadata.id || datasetId);
        await loadPreviousMonthData(res.metadata.month || "");
      }
    } catch {
      alert("Failed to load month.");
    }
  };

  const handleDelete = async (datasetId) => {
    if (!datasetId) return;
    if (!window.confirm("Delete this saved dataset?")) return;

    setIsDeletingId(datasetId);
    try {
      await deleteDataset(datasetId);
      if (selectedDatasetId === datasetId) {
        setData([]);
        setSelectedDatasetId("");
        setCurrentDatasetMeta(null);
        setPreviousMonthData([]);
      }
      await Promise.all([refreshDatasets(), refreshHistory()]);
    } catch {
      alert("Failed to delete dataset.");
    } finally {
      setIsDeletingId("");
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-content">
          <img src={logo} alt="TREL Logo" className="app-logo" />
          <div>
            <h1>TREL Payroll Control Dashboard</h1>
            <p>Structured overview of employee payouts based on payroll documents</p>
          </div>
        </div>
      </header>

      <main className="app-main">
        {error && (
          <div className="error-banner">
            {error}
          </div>
        )}

        <div className="history-section card toolbar-section">
          <div className="toolbar-row">
            <div className="toolbar-group">
              <span className="toolbar-label">Current Month:</span>
              <span className="toolbar-value">{currentMonth || "-"}</span>
            </div>

            <div className="toolbar-group">
              <span className="toolbar-label">Load Version:</span>
              <select
                value={selectedDatasetId}
                onChange={(e) => handleLoad(e.target.value)}
                className="toolbar-select"
                disabled={visibleDatasets.length === 0}
              >
                <option value="">{visibleDatasets.length ? "Select saved version..." : "No saved versions"}</option>
                {visibleDatasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {buildDisplayVersion(dataset)}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleSave}
              disabled={!currentMonth || !data.length || isSaving}
              className="btn-primary toolbar-button"
            >
              {isSaving ? "Saving..." : "Save Month"}
            </button>
          </div>

          <div className="tab-row">
            <button
              className={`tab-button ${activeTab === "dashboard" ? "tab-button-active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
            >
              <Table2 size={16} /> Dashboard
            </button>
            <button
              className={`tab-button ${activeTab === "history" ? "tab-button-active" : ""}`}
              onClick={() => setActiveTab("history")}
            >
              <History size={16} /> History
            </button>
          </div>
        </div>

        {activeTab === "history" ? (
          <div className="card table-container">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Month</th>
                  <th>Version</th>
                  <th>IP Address</th>
                  <th>Action</th>
                  <th className="text-right">Delete</th>
                </tr>
              </thead>
              <tbody>
                {historyEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.date || "-"}</td>
                    <td>{entry.month || "-"}</td>
                    <td>{entry.version || "-"}</td>
                    <td>{entry.ipAddress || "-"}</td>
                    <td>{entry.action}</td>
                    <td className="text-right">
                      {entry.canDelete ? (
                        <button
                          type="button"
                          className="icon-button danger"
                          onClick={() => handleDelete(entry.datasetId)}
                          disabled={isDeletingId === entry.datasetId}
                          aria-label={`Delete ${entry.version}`}
                        >
                          <X size={16} />
                        </button>
                      ) : (
                        <span className="text-gray-light">-</span>
                      )}
                    </td>
                  </tr>
                ))}
                {historyEntries.length === 0 && (
                  <tr>
                    <td colSpan="6" className="text-center py-8 text-gray">
                      No history entries found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : data.length === 0 ? (
          <div className="upload-section">
            <div className="welcome-card">
              <h2>Upload Payroll Documents</h2>
              <p>Upload payroll PDFs to extract employee payout data</p>
              <FileUpload onUpload={handleUpload} isProcessing={isProcessing} />
            </div>
          </div>
        ) : (
          <div className="dashboard-section">
            <div className="dashboard-header">
              <button className="btn-text" onClick={() => setData([])}>← Upload New Files</button>
            </div>
            <Dashboard
              data={data}
              previousMonthData={previousMonthData}
              currentDatasetMeta={currentDatasetMeta}
            />
          </div>
        )}
      </main>

      <footer className="app-footer">
        Developed by Eren Burak Gökpinar for Tree Logistics GmbH
      </footer>
    </div>
  );
}

export default App;
