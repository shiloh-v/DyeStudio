export const DateUtils = {
    // Get current date in EST as YYYY-MM-DD
    getTodayEST: () => {
        return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    },
    
    // Get current datetime in EST
    getNowEST: () => {
        return new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    },
    
    // Format date for display in EST
    formatDate: (dateStr) => {
        if (!dateStr) return '';
        const date = new Date(dateStr + 'T12:00:00'); // Noon to avoid timezone shifts
        return date.toLocaleDateString('en-US', { 
            timeZone: 'America/New_York',
            year: 'numeric',
            month: 'numeric', 
            day: 'numeric'
        });
    },
    
    // Format datetime for display in EST
    formatDateTime: (isoStr) => {
        if (!isoStr) return '';
        const date = new Date(isoStr);
        return date.toLocaleString('en-US', { 
            timeZone: 'America/New_York',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }
};
