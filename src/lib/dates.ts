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

/**
 * Sort sessions by planned date, earliest first; sessions with NO date yet
 * (drafts) go last.
 */
export const byPlannedDate = (a: { date?: string }, b: { date?: string }) => {
    const ta = a?.date ? Date.parse(a.date + 'T12:00:00') : Infinity;
    const tb = b?.date ? Date.parse(b.date + 'T12:00:00') : Infinity;
    return ta === tb ? 0 : ta < tb ? -1 : 1;
};
