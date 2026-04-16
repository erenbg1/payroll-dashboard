import React, { useState, useMemo } from 'react';
import { Download, Search, Filter, Users, DollarSign, AlertTriangle } from 'lucide-react';

const formatCurrency = (value) => {
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
    }).format(value);
};

const normalizeKeywords = (keywords) => {
    if (Array.isArray(keywords)) {
        return keywords.filter(Boolean);
    }

    if (typeof keywords !== 'string') {
        return [];
    }

    const trimmed = keywords.trim();
    if (!trimmed || trimmed.toLowerCase() === 'no') {
        return [];
    }

    return trimmed.split(',').map((value) => value.trim()).filter(Boolean);
};

const getPersonalNumber = (item) => {
    const personalNumber = item?.['Personal-Nr'];
    if (personalNumber === null || personalNumber === undefined) {
        return '';
    }

    const normalized = String(personalNumber).trim();
    if (!normalized || normalized.toLowerCase() === 'unknown') {
        return '';
    }

    return normalized;
};

const getPayoutValue = (item) => {
    const payout = item?.Auszahlung;
    return typeof payout === 'number' && Number.isFinite(payout) ? payout : 0;
};

const Dashboard = ({ data, previousMonthData = [] }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterKeyword, setFilterKeyword] = useState('All');

    const previousMonthMap = useMemo(() => {
        const result = new Map();

        previousMonthData.forEach((item) => {
            const personalNumber = getPersonalNumber(item);
            if (!personalNumber || result.has(personalNumber)) {
                return;
            }

            result.set(personalNumber, getPayoutValue(item));
        });

        return result;
    }, [previousMonthData]);

    const rowsWithDelta = useMemo(() => {
        const hasPreviousMonthData = previousMonthData.length > 0;

        return data.map((item) => {
            const personalNumber = getPersonalNumber(item);
            const payoutValue = getPayoutValue(item);
            const keywordsList = normalizeKeywords(item.Keywords);
            const previousPayout = personalNumber ? previousMonthMap.get(personalNumber) : undefined;

            let deltaDisplay = '-';
            let deltaClassName = '';
            let deltaSortValue = null;

            if (hasPreviousMonthData) {
                if (!personalNumber) {
                    deltaDisplay = '-';
                } else if (previousPayout === undefined) {
                    deltaDisplay = 'New';
                } else {
                    const deltaValue = payoutValue - previousPayout;
                    deltaSortValue = deltaValue;
                    deltaDisplay = formatCurrency(deltaValue);
                    if (deltaValue > 0) {
                        deltaClassName = 'delta-positive';
                    } else if (deltaValue < 0) {
                        deltaClassName = 'delta-negative';
                    }
                }
            }

            return {
                ...item,
                _personalNumber: personalNumber,
                _name: typeof item?.Name === 'string' ? item.Name : '',
                _filename: typeof item?.Filename === 'string' ? item.Filename : '',
                _payoutValue: payoutValue,
                _keywordsList: keywordsList,
                _keywordsDisplay: keywordsList.join(', '),
                _hasKeywords: keywordsList.length > 0,
                _deltaDisplay: deltaDisplay,
                _deltaClassName: deltaClassName,
                _deltaSortValue: deltaSortValue,
            };
        });
    }, [data, previousMonthData, previousMonthMap]);

    // Calculate Summaries
    const stats = useMemo(() => {
        const totalEmployees = new Set(rowsWithDelta.map((row) => row._personalNumber || `missing-${row.Name}-${row.Page}`)).size;
        const totalAuszahlung = rowsWithDelta.reduce((acc, curr) => acc + curr._payoutValue, 0);
        const keywordHits = rowsWithDelta.filter((row) => row._hasKeywords).length;
        return { totalEmployees, totalAuszahlung, keywordHits };
    }, [rowsWithDelta]);

    // Filter Data
    const filteredData = useMemo(() => {
        const normalizedSearch = searchTerm.toLowerCase();

        return rowsWithDelta.filter((item) => {
            const matchesSearch =
                item._personalNumber.toLowerCase().includes(normalizedSearch) ||
                item._name.toLowerCase().includes(normalizedSearch) ||
                item._filename.toLowerCase().includes(normalizedSearch);

            const matchesKeyword =
                filterKeyword === 'All' ||
                (filterKeyword === 'Has Keywords' && item._hasKeywords) ||
                (filterKeyword === 'No Keywords' && !item._hasKeywords);

            return matchesSearch && matchesKeyword;
        });
    }, [rowsWithDelta, searchTerm, filterKeyword]);

    const downloadCSV = () => {
        if (!rowsWithDelta.length) return;

        const headers = ['Name', 'Personal-Nr', 'Keywords', 'Auszahlung', 'Δ Previous Month'];
        const csvContent = [
            headers.join(';'),
            ...filteredData.map((row) => [
                `"${row._name}"`,
                row._personalNumber || '',
                `"${row._keywordsDisplay}"`,
                `"${formatCurrency(row._payoutValue)}"`,
                `"${row._deltaDisplay}"`
            ].join(';'))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'payroll_export.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (!data.length) return null;

    return (
        <div className="dashboard">
            {/* Stats Cards */}
            <div className="stats-grid">
                <div className="card stat-card">
                    <div className="stat-icon bg-blue-light"><Users size={24} className="text-blue" /></div>
                    <div>
                        <h3>Total Employees</h3>
                        <div className="stat-value">{stats.totalEmployees}</div>
                    </div>
                </div>
                <div className="card stat-card">
                    <div className="stat-icon bg-green-light"><DollarSign size={24} className="text-green" /></div>
                    <div>
                        <h3>Total Payout</h3>
                        <div className="stat-value">{formatCurrency(stats.totalAuszahlung)}</div>
                    </div>
                </div>
                <div className="card stat-card">
                    <div className="stat-icon bg-orange-light"><AlertTriangle size={24} className="text-orange" /></div>
                    <div>
                        <h3>Keyword Hits</h3>
                        <div className="stat-value">{stats.keywordHits}</div>
                    </div>
                </div>
            </div>

            {/* Controls */}
            <div className="controls-bar">
                <div className="search-wrapper">
                    <Search size={20} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search by Name or Personal-Nr..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="filters-wrapper">
                    <Filter size={20} className="text-gray" />
                    <select value={filterKeyword} onChange={(e) => setFilterKeyword(e.target.value)}>
                        <option value="All">All Records</option>
                        <option value="Has Keywords">Has Keywords</option>
                        <option value="No Keywords">No Keywords</option>
                    </select>
                </div>

                <button className="btn-secondary" onClick={downloadCSV}>
                    <Download size={18} /> Export CSV
                </button>
            </div>

            {/* Table */}
            <div className="card table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Personal-Nr</th>
                            <th className="text-right">Auszahlung</th>
                            <th className="text-right">Δ Previous Month</th>
                            <th>Keywords</th>
                            <th>Page</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredData.map((row, idx) => (
                            <tr key={idx} className={row._hasKeywords ? 'row-warning' : ''}>
                                <td className="font-bold">{row._name || '-'}</td>
                                <td className="font-mono">{row._personalNumber || '-'}</td>
                                <td className="text-right font-bold">
                                    {formatCurrency(row._payoutValue)}
                                </td>
                                <td className={`text-right font-bold ${row._deltaClassName}`}>
                                    {row._deltaDisplay}
                                </td>
                                <td>
                                    {row._hasKeywords ? (
                                        <span className="badge badge-warning">{row._keywordsDisplay}</span>
                                    ) : (
                                        <span className="text-gray-light">-</span>
                                    )}
                                </td>
                                <td className="text-sm text-gray">{row.Page}</td>
                            </tr>
                        ))}
                        {filteredData.length === 0 && (
                            <tr>
                                <td colSpan="6" className="text-center py-8 text-gray">
                                    No matching records found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Dashboard;
