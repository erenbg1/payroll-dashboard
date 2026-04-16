import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const uploadFiles = async (files) => {
    const formData = new FormData();
    files.forEach((file) => {
        formData.append('files', file);
    });

    try {
        const response = await axios.post(`${API_URL}/upload`, formData, {
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
        const response = await axios.post(`${API_URL}/save-month`, { month, data });
        return response.data;
    } catch (error) {
        console.error('Error saving month:', error);
        throw error;
    }
};

export const listMonths = async () => {
    try {
        const response = await axios.get(`${API_URL}/list-months`);
        return response.data; // { months: [...] }
    } catch (error) {
        console.error('Error listing months:', error);
        throw error;
    }
};

export const loadMonth = async (month) => {
    try {
        const response = await axios.get(`${API_URL}/load-month/${month}`);
        return response.data; // { data: [...] }
    } catch (error) {
        console.error('Error loading month:', error);
        throw error;
    }
};

export const listDatasets = async () => {
    try {
        const response = await axios.get(`${API_URL}/datasets`);
        return response.data;
    } catch (error) {
        console.error('Error listing datasets:', error);
        throw error;
    }
};

export const listHistory = async () => {
    try {
        const response = await axios.get(`${API_URL}/history`);
        return response.data;
    } catch (error) {
        console.error('Error loading history:', error);
        throw error;
    }
};

export const deleteDataset = async (datasetId) => {
    try {
        const response = await axios.delete(`${API_URL}/dataset/${datasetId}`);
        return response.data;
    } catch (error) {
        console.error('Error deleting dataset:', error);
        throw error;
    }
};
