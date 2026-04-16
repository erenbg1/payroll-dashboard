import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '';
const AUTH_STORAGE_KEY = 'trel-payroll-auth-token';

const apiClient = axios.create({
    baseURL: API_URL,
});

apiClient.interceptors.request.use((config) => {
    const token = window.sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export const getStoredAuthToken = () => window.sessionStorage.getItem(AUTH_STORAGE_KEY);

export const setStoredAuthToken = (token) => {
    if (token) {
        window.sessionStorage.setItem(AUTH_STORAGE_KEY, token);
    } else {
        window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }
};

export const uploadFiles = async (files) => {
    const formData = new FormData();
    files.forEach((file) => {
        formData.append('files', file);
    });

    try {
        const response = await apiClient.post('/upload', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        return response.data;
    } catch (error) {
        console.error('Error uploading files:', error);
        throw error;
    }
};

export const saveMonth = async (month, data) => {
    try {
        const response = await apiClient.post('/save-month', { month, data });
        return response.data;
    } catch (error) {
        console.error('Error saving month:', error);
        throw error;
    }
};

export const listMonths = async () => {
    try {
        const response = await apiClient.get('/list-months');
        return response.data; // { months: [...] }
    } catch (error) {
        console.error('Error listing months:', error);
        throw error;
    }
};

export const loadMonth = async (month) => {
    try {
        const response = await apiClient.get(`/load-month/${month}`);
        return response.data; // { data: [...] }
    } catch (error) {
        console.error('Error loading month:', error);
        throw error;
    }
};

export const listDatasets = async () => {
    try {
        const response = await apiClient.get('/datasets');
        return response.data;
    } catch (error) {
        console.error('Error listing datasets:', error);
        throw error;
    }
};

export const listHistory = async () => {
    try {
        const response = await apiClient.get('/history');
        return response.data;
    } catch (error) {
        console.error('Error loading history:', error);
        throw error;
    }
};

export const login = async (password) => {
    const response = await apiClient.post('/auth/login', { password });
    return response.data;
};

export const getAuthStatus = async () => {
    const response = await apiClient.get('/auth/status');
    return response.data;
};
