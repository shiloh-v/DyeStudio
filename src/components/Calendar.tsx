import React, { useState } from 'react';

export function Calendar({ dyeSessions, setActiveTab }) {
    const [currentDate, setCurrentDate] = React.useState(new Date());
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    // Build calendar days array
    const getDaysInMonth = () => {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startingDayOfWeek = firstDay.getDay();
        const daysInMonth = lastDay.getDate();
        
        const days = [];
        
        // Add empty cells for days before month starts
        for (let i = 0; i < startingDayOfWeek; i++) {
            days.push(null);
        }
        
        // Add all days in month
        for (let day = 1; day <= daysInMonth; day++) {
            days.push(new Date(year, month, day));
        }
        
        return days;
    };
    
    const days = getDaysInMonth();
    
    const getSessionsForDate = (date) => {
        if (!date) return [];
        const dateStr = date.toISOString().split('T')[0];
        return dyeSessions.filter(s => !s.archived && s.date === dateStr);
    };
    
    const monthNames = ["January", "February", "March", "April", "May", "June",
                      "July", "August", "September", "October", "November", "December"];
    
    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-900">📅 Dye Session Calendar</h2>
                <div className="flex gap-3">
                    <button
                        onClick={() => setCurrentDate(new Date(year, month - 1, 1))}
                        className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
                    >
                        ← Previous
                    </button>
                    <button
                        onClick={() => setCurrentDate(new Date())}
                        className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                    >
                        Today
                    </button>
                    <button
                        onClick={() => setCurrentDate(new Date(year, month + 1, 1))}
                        className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
                    >
                        Next →
                    </button>
                </div>
            </div>
            
            <div className="bg-gray-50 rounded-lg card-shadow border border-gray-200 p-6">
                <h3 className="text-xl font-semibold mb-4 text-center">{monthNames[month]} {year}</h3>
                
                {/* Day headers */}
                <div className="grid grid-cols-7 gap-2 mb-2" style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)'}}>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                        <div key={day} className="text-center font-semibold text-gray-600 text-sm py-2">
                            {day}
                        </div>
                    ))}
                </div>
                
                {/* Calendar grid */}
                <div className="grid grid-cols-7 gap-2" style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '128px'}}>
                    {days.map((date, idx) => {
                        if (!date) {
                            return <div key={`empty-${idx}`} className="h-32"></div>;
                        }
                        
                        const isCurrentMonth = date.getMonth() === month;
                        const isToday = date.toDateString() === new Date().toDateString();
                        const sessions = getSessionsForDate(date);
                        
                        // Check if this date is part of a dye cycle
                        const dateStr = date.toISOString().split('T')[0];
                        const cycleInfo = [];
                        
                        dyeSessions.forEach(session => {
                            // Show all sessions, including archived ones
                            
                            const sessionDate = new Date(session.date + 'T12:00:00');
                            const prepDate = new Date(sessionDate);
                            prepDate.setDate(prepDate.getDate() - 1);
                            const rinseDate = new Date(sessionDate);
                            rinseDate.setDate(rinseDate.getDate() + 1);
                            const dryDate = new Date(sessionDate);
                            dryDate.setDate(dryDate.getDate() + 2);
                            const finishDate = new Date(sessionDate);
                            finishDate.setDate(finishDate.getDate() + 3);
                            
                            const prepDateStr = prepDate.toISOString().split('T')[0];
                            const rinseDateStr = rinseDate.toISOString().split('T')[0];
                            const dryDateStr = dryDate.toISOString().split('T')[0];
                            const finishDateStr = finishDate.toISOString().split('T')[0];
                            
                            // Use gray colors for archived sessions
                            const isArchived = session.archived;
                            const colors = isArchived ? {
                                prep: 'bg-gray-200 text-gray-600',
                                dye: 'bg-gray-200 text-gray-600',
                                rinse: 'bg-gray-200 text-gray-600',
                                dry: 'bg-gray-200 text-gray-600',
                                finish: 'bg-gray-200 text-gray-600'
                            } : {
                                prep: 'bg-yellow-100 text-yellow-800',
                                dye: 'bg-teal-100 text-teal-800',
                                rinse: 'bg-blue-100 text-blue-800',
                                dry: 'bg-orange-100 text-orange-800',
                                finish: 'bg-green-100 text-green-800'
                            };
                            
                            if (dateStr === prepDateStr) {
                                cycleInfo.push({ type: 'prep', session: session.name, color: colors.prep, archived: isArchived });
                            } else if (dateStr === session.date) {
                                cycleInfo.push({ type: 'dye', session: session.name, color: colors.dye, archived: isArchived });
                            } else if (dateStr === rinseDateStr) {
                                cycleInfo.push({ type: 'rinse', session: session.name, color: colors.rinse, archived: isArchived });
                            } else if (dateStr === dryDateStr) {
                                cycleInfo.push({ type: 'dry', session: session.name, color: colors.dry, archived: isArchived });
                            } else if (dateStr === finishDateStr) {
                                cycleInfo.push({ type: 'finish', session: session.name, color: colors.finish, archived: isArchived });
                            }
                        });
                        
                        const cycleLabels = {
                            prep: '🔧 Prep',
                            dye: '🎨 Dye',
                            rinse: '💧 Rinse',
                            dry: '☀️ Dry',
                            finish: '✨ Finish'
                        };
                        
                        return (
                            <div
                                key={idx}
                                className={`p-2 border rounded-lg overflow-y-auto ${
                                    isCurrentMonth ? 'bg-white' : 'bg-gray-50'
                                } ${isToday ? 'border-teal-500 border-2' : 'border-gray-200'}`}
                                style={{height: '128px'}}
                            >
                                <div className={`text-sm font-medium ${
                                    isCurrentMonth ? 'text-gray-900' : 'text-gray-400'
                                } ${isToday ? 'text-teal-600 font-bold' : ''}`}>
                                    {date.getDate()}
                                </div>
                                {cycleInfo.length > 0 && (
                                    <div className="mt-1 space-y-1">
                                        {cycleInfo.map((info, cidx) => (
                                            <div
                                                key={cidx}
                                                onClick={() => setActiveTab('sessions')}
                                                className={`text-xs px-1 py-0.5 rounded cursor-pointer hover:opacity-80 ${info.color}`}
                                                title={`${info.session}: ${cycleLabels[info.type]} Day${info.archived ? ' (Archived)' : ''}`}
                                            >
                                                <div className="font-medium truncate">{cycleLabels[info.type]}</div>
                                                <div className="truncate text-xs opacity-75">
                                                    {info.session}{info.archived ? ' (Archived)' : ''}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
