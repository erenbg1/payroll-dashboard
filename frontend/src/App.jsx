import React, { useCallback, useMemo, useState } from 'react';
import FileUpload from './components/FileUpload';
import Dashboard from './components/Dashboard';
import { Eye, EyeOff, History, Table2 } from 'lucide-react';
import {
  getAuthStatus,
  getStoredAuthToken,
  listDatasets,
  listHistory,
  loadMonth,
  login,
  saveMonth,
  setStoredAuthToken,
  uploadFiles,
} from './api';
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

const isUnauthorizedError = (error) => error?.response?.status === 401;

const formatAuditDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const formatAuditTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authPassword, setAuthPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authAttemptsUsed, setAuthAttemptsUsed] = useState(0);
  const [authMaxAttempts, setAuthMaxAttempts] = useState(3);
  const [authBlockedUntil, setAuthBlockedUntil] = useState(0);

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

  const handleUnauthorized = (message = "Your session expired. Please enter the password again.") => {
    setStoredAuthToken(null);
    setIsAuthenticated(false);
    setIsCheckingAuth(false);
    setAuthError(message);
    setData([]);
    setDatasets([]);
    setHistoryEntries([]);
    setSelectedDatasetId("");
    setCurrentDatasetMeta(null);
    setPreviousMonthData([]);
    setActiveTab("dashboard");
  };

  const formatBlockedUntil = (timestampSeconds) => {
    if (!timestampSeconds) {
      return "";
    }

    return new Date(timestampSeconds * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const refreshDatasets = useCallback(async () => {
    try {
      const datasetsRes = await listDatasets();
      if (datasetsRes?.datasets) {
        setDatasets(datasetsRes.datasets);
      }
    } catch (e) {
      if (isUnauthorizedError(e)) {
        handleUnauthorized();
        return;
      }
      console.error("Failed to load saved datasets", e);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await listHistory();
      if (res?.history) {
        setHistoryEntries(res.history);
      }
    } catch (e) {
      if (isUnauthorizedError(e)) {
        handleUnauthorized();
        return;
      }
      console.error("Failed to load history log", e);
    }
  }, []);

  React.useEffect(() => {
    const verifySession = async () => {
      const token = getStoredAuthToken();
      if (!token) {
        setIsCheckingAuth(false);
        return;
      }

      try {
        await getAuthStatus();
        setIsAuthenticated(true);
      } catch {
        setStoredAuthToken(null);
        setIsAuthenticated(false);
      } finally {
        setIsCheckingAuth(false);
      }
    };

    verifySession();
  }, []);

  React.useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const loadInitialState = async () => {
      await Promise.all([refreshDatasets(), refreshHistory()]);
    };

    loadInitialState();
  }, [isAuthenticated, refreshDatasets, refreshHistory]);

  const handleLogin = async (event) => {
    event.preventDefault();

    if (!authPassword.trim()) {
      setAuthError("Enter the dashboard password.");
      return;
    }

    setIsAuthenticating(true);
    setAuthError("");

    try {
      const result = await login(authPassword);
      setStoredAuthToken(result?.token || "");
      setIsAuthenticated(true);
      setAuthPassword("");
      setAuthAttemptsUsed(0);
      setAuthMaxAttempts(result?.maxAttempts || 3);
      setAuthBlockedUntil(0);
      await Promise.all([refreshDatasets(), refreshHistory()]);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const attemptsUsed = detail?.attemptsUsed ?? 0;
      const maxAttempts = detail?.maxAttempts ?? 3;
      const blockedUntil = detail?.blockedUntil ?? 0;

      setAuthAttemptsUsed(attemptsUsed);
      setAuthMaxAttempts(maxAttempts);
      setAuthBlockedUntil(blockedUntil);

      if (e?.response?.status === 429) {
        const blockedText = formatBlockedUntil(blockedUntil);
        setAuthError(
          blockedText
            ? `Too many attempts. Try again after ${blockedText}.`
            : "Too many attempts. Try again later."
        );
      } else {
        setAuthError("Incorrect password.");
      }
      setStoredAuthToken(null);
      setIsAuthenticated(false);
    } finally {
      setIsCheckingAuth(false);
      setIsAuthenticating(false);
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
    } catch (e) {
      if (isUnauthorizedError(e)) {
        handleUnauthorized();
      } else {
        setError("Failed to process files. Please try again.");
      }
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
      if (isUnauthorizedError(e)) {
        handleUnauthorized();
        return;
      }
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
    } catch (e) {
      if (isUnauthorizedError(e)) {
        handleUnauthorized();
      } else {
        alert("Failed to save data.");
      }
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
    } catch (e) {
      if (isUnauthorizedError(e)) {
        handleUnauthorized();
      } else {
        alert("Failed to load month.");
      }
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
        {isCheckingAuth ? (
          <div className="upload-section">
            <div className="welcome-card auth-card">
              <h2>Checking Access</h2>
              <p>Verifying dashboard session</p>
            </div>
          </div>
        ) : !isAuthenticated ? (
          <div className="upload-section">
            <div className="welcome-card auth-card">
              <h2>Protected Dashboard</h2>
              <p>Enter the dashboard password to access payroll records</p>
              <form className="auth-form" onSubmit={handleLogin}>
                <div className="auth-input-wrapper">
                  <input
                    type={isPasswordVisible ? "text" : "password"}
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="Password"
                    className="auth-input"
                    autoComplete="current-password"
                    disabled={Boolean(authBlockedUntil && authBlockedUntil > Math.floor(Date.now() / 1000))}
                  />
                  <button
                    type="button"
                    className="auth-visibility-toggle"
                    onClick={() => setIsPasswordVisible((visible) => !visible)}
                    aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                    disabled={Boolean(authBlockedUntil && authBlockedUntil > Math.floor(Date.now() / 1000))}
                  >
                    {isPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <button
                  type="submit"
                  className="btn-primary auth-button"
                  disabled={isAuthenticating || Boolean(authBlockedUntil && authBlockedUntil > Math.floor(Date.now() / 1000))}
                >
                  {isAuthenticating ? "Checking..." : "Unlock Dashboard"}
                </button>
              </form>
              <p className="auth-attempts">
                {authAttemptsUsed}/{authMaxAttempts} attempts used
              </p>
              {authError && <p className="auth-error">{authError}</p>}
            </div>
          </div>
        ) : (
          <>
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
                      <th>Time</th>
                      <th>Action</th>
                      <th>IP Address</th>
                      <th className="mobile-hide">User Agent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td>{formatAuditDate(entry.timestamp)}</td>
                        <td>{formatAuditTime(entry.timestamp)}</td>
                        <td>{entry.action || "-"}</td>
                        <td>{entry.ip_address || "-"}</td>
                        <td className="text-sm text-gray mobile-hide" title={entry.user_agent || "-"}>
                          {entry.user_agent || "-"}
                        </td>
                      </tr>
                    ))}
                    {historyEntries.length === 0 && (
                      <tr>
                        <td colSpan="5" className="text-center py-8 text-gray">
                          No history yet
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
          </>
        )}
      </main>

      <footer className="app-footer">
        Developed by Eren Burak Gökpinar for Tree Logistics GmbH
      </footer>
    </div>
  );
}

export default App;
