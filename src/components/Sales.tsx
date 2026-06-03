import { DateUtils } from '../lib/dates';

export function Sales({ sales, saveSales, batches, saveBatches }) {
    // Get sold batches for display
    const soldBatches = batches.filter(b => b.status === 'sold');
    
    // Calculate statistics from sold batches
    const totalRevenue = soldBatches.reduce((sum, b) => sum + (b.salePrice || 0), 0);
    const totalProfit = soldBatches.reduce((sum, b) => sum + (b.profit || 0), 0);
    const totalCost = soldBatches.reduce((sum, b) => sum + (b.totalCost || 0), 0);
    const avgProfitMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100) : 0;
    const avgSale = soldBatches.length > 0 ? totalRevenue / soldBatches.length : 0;

    // Sales by month from sold batches
    const salesByMonth: Record<string, number> = soldBatches.reduce((acc, batch) => {
        const month = new Date(batch.soldDate || batch.startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        acc[month] = (acc[month] || 0) + (batch.salePrice || 0);
        return acc;
    }, {} as Record<string, number>);
    
    // Top selling bases (by revenue)
    const baseStats: Record<string, { count: number; revenue: number }> = {};
    soldBatches.forEach(batch => {
        if (batch.yarnDetails) {
            batch.yarnDetails.forEach(yarn => {
                const key = yarn.base;
                if (!baseStats[key]) {
                    baseStats[key] = { count: 0, revenue: 0 };
                }
                baseStats[key].count += parseInt(yarn.quantity || 0);
                // Proportional revenue for this yarn in the batch
                const totalSkeins = batch.skeins || 1;
                const yarnSkeins = parseInt(yarn.quantity || 0);
                const yarnRevenue = (yarnSkeins / totalSkeins) * (batch.salePrice || 0);
                baseStats[key].revenue += yarnRevenue;
            });
        }
    });
    const topBases = Object.entries(baseStats)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 5);
    
    // Top selling colorways (by revenue)
    const colorwayStats: Record<string, { count: number; revenue: number }> = {};
    soldBatches.forEach(batch => {
        const key = batch.colorway;
        if (!colorwayStats[key]) {
            colorwayStats[key] = { count: 0, revenue: 0 };
        }
        colorwayStats[key].count += 1;
        colorwayStats[key].revenue += batch.salePrice || 0;
    });
    const topColorways = Object.entries(colorwayStats)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 5);
    
    // Top base + colorway combos
    const comboStats: Record<string, { count: number; revenue: number }> = {};
    soldBatches.forEach(batch => {
        if (batch.yarnDetails) {
            batch.yarnDetails.forEach(yarn => {
                const key = `${yarn.base} - ${batch.colorway}`;
                if (!comboStats[key]) {
                    comboStats[key] = { count: 0, revenue: 0 };
                }
                comboStats[key].count += parseInt(yarn.quantity || 0);
                const totalSkeins = batch.skeins || 1;
                const yarnSkeins = parseInt(yarn.quantity || 0);
                const yarnRevenue = (yarnSkeins / totalSkeins) * (batch.salePrice || 0);
                comboStats[key].revenue += yarnRevenue;
            });
        }
    });
    const topCombos = Object.entries(comboStats)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 5);
    
    // Performance over time (last 6 months)
    const monthlyPerformance: Record<string, { sales: number; revenue: number; profit: number; totalRevenue: number }> = {};
    soldBatches.forEach(batch => {
        const month = new Date(batch.soldDate || batch.startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        if (!monthlyPerformance[month]) {
            monthlyPerformance[month] = { sales: 0, revenue: 0, profit: 0, totalRevenue: 0 };
        }
        monthlyPerformance[month].sales += 1;
        monthlyPerformance[month].revenue += batch.salePrice || 0;
        monthlyPerformance[month].profit += batch.profit || 0;
        monthlyPerformance[month].totalRevenue += batch.salePrice || 0;
    });
    
    const performanceData = Object.entries(monthlyPerformance)
        .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
        .slice(-6) // Last 6 months
        .map(([month, data]) => ({
            month,
            ...data,
            margin: data.totalRevenue > 0 ? ((data.profit / data.totalRevenue) * 100) : 0
        }));

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-900">Sales Tracking</h2>
            </div>

            {/* Stats */}
            <div className="grid md:grid-cols-4 gap-6">
                <div className="bg-white rounded-lg card-shadow p-6">
                    <div className="text-sm text-gray-600 mb-1">Total Sales</div>
                    <div className="text-3xl font-bold text-gray-900">{soldBatches.length}</div>
                </div>
                <div className="bg-white rounded-lg card-shadow p-6">
                    <div className="text-sm text-gray-600 mb-1">Total Revenue</div>
                    <div className="text-3xl font-bold text-green-600">${totalRevenue.toFixed(2)}</div>
                </div>
                <div className="bg-white rounded-lg card-shadow p-6">
                    <div className="text-sm text-gray-600 mb-1">Total Profit</div>
                    <div className="text-3xl font-bold text-blue-600">${totalProfit.toFixed(2)}</div>
                </div>
                <div className="bg-white rounded-lg card-shadow p-6">
                    <div className="text-sm text-gray-600 mb-1">Avg Margin</div>
                    <div className="text-3xl font-bold text-purple-600">{avgProfitMargin.toFixed(1)}%</div>
                </div>
            </div>
            
            {/* Performance Over Time */}
            {performanceData.length > 0 && (
                <div className="bg-white rounded-lg card-shadow p-6">
                    <h3 className="text-lg font-semibold mb-4">Performance Trends (Last 6 Months)</h3>
                    <div className="grid md:grid-cols-2 gap-6">
                        {/* Sales & Revenue Chart */}
                        <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-3">Sales & Revenue</h4>
                            <div className="space-y-3">
                                {performanceData.map(data => (
                                    <div key={data.month}>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-gray-600">{data.month}</span>
                                            <span className="font-semibold">{data.sales} sales • ${data.revenue.toFixed(0)}</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <div 
                                                className="h-6 bg-purple-500 rounded flex items-center justify-end pr-2 text-white text-xs"
                                                style={{width: `${Math.max(10, (data.sales / Math.max(...performanceData.map(d => d.sales))) * 100)}%`}}
                                            >
                                                {data.sales}
                                            </div>
                                            <div 
                                                className="h-6 bg-green-500 rounded flex items-center justify-end pr-2 text-white text-xs"
                                                style={{width: `${Math.max(10, (data.revenue / Math.max(...performanceData.map(d => d.revenue))) * 100)}%`}}
                                            >
                                                ${data.revenue.toFixed(0)}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        {/* Profit & Margin Chart */}
                        <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-3">Profit & Margin</h4>
                            <div className="space-y-3">
                                {performanceData.map(data => (
                                    <div key={data.month}>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-gray-600">{data.month}</span>
                                            <span className="font-semibold">${data.profit.toFixed(0)} • {data.margin.toFixed(1)}%</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <div 
                                                className="h-6 bg-blue-500 rounded flex items-center justify-end pr-2 text-white text-xs"
                                                style={{width: `${Math.max(10, (data.profit / Math.max(...performanceData.map(d => d.profit))) * 100)}%`}}
                                            >
                                                ${data.profit.toFixed(0)}
                                            </div>
                                            <div 
                                                className="h-6 bg-purple-500 rounded flex items-center justify-end pr-2 text-white text-xs"
                                                style={{width: `${Math.max(10, data.margin)}%`}}
                                            >
                                                {data.margin.toFixed(1)}%
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Top Sellers */}
            <div className="grid md:grid-cols-3 gap-6">
                {/* Top Bases */}
                {topBases.length > 0 && (
                    <div className="bg-white rounded-lg card-shadow p-6">
                        <h3 className="text-lg font-semibold mb-4">🧶 Top Selling Bases</h3>
                        <div className="space-y-3">
                            {topBases.map(([base, stats], idx) => (
                                <div key={base} className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl font-bold text-gray-400">#{idx + 1}</span>
                                        <div>
                                            <div className="font-medium text-sm">{base}</div>
                                            <div className="text-xs text-gray-500">{stats.count} skeins</div>
                                        </div>
                                    </div>
                                    <div className="text-sm font-semibold text-green-600">${stats.revenue.toFixed(0)}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                
                {/* Top Colorways */}
                {topColorways.length > 0 && (
                    <div className="bg-white rounded-lg card-shadow p-6">
                        <h3 className="text-lg font-semibold mb-4">🎨 Top Selling Colors</h3>
                        <div className="space-y-3">
                            {topColorways.map(([colorway, stats], idx) => (
                                <div key={colorway} className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl font-bold text-gray-400">#{idx + 1}</span>
                                        <div>
                                            <div className="font-medium text-sm">{colorway}</div>
                                            <div className="text-xs text-gray-500">{stats.count} batches</div>
                                        </div>
                                    </div>
                                    <div className="text-sm font-semibold text-green-600">${stats.revenue.toFixed(0)}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                
                {/* Top Combos */}
                {topCombos.length > 0 && (
                    <div className="bg-white rounded-lg card-shadow p-6">
                        <h3 className="text-lg font-semibold mb-4">⭐ Top Combos</h3>
                        <div className="space-y-3">
                            {topCombos.map(([combo, stats], idx) => (
                                <div key={combo} className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl font-bold text-gray-400">#{idx + 1}</span>
                                        <div>
                                            <div className="font-medium text-sm">{combo}</div>
                                            <div className="text-xs text-gray-500">{stats.count} skeins</div>
                                        </div>
                                    </div>
                                    <div className="text-sm font-semibold text-green-600">${stats.revenue.toFixed(0)}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Sales by Month */}
            {Object.keys(salesByMonth).length > 0 && (
                <div className="bg-white rounded-lg card-shadow p-6">
                    <h3 className="text-lg font-semibold mb-4">Revenue by Month</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        {Object.entries(salesByMonth).sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()).map(([month, amount]) => (
                            <div key={month} className="text-center p-3 bg-purple-50 rounded-lg">
                                <div className="text-sm text-gray-600 mb-1">{month}</div>
                                <div className="text-lg font-bold text-purple-600">${amount.toFixed(2)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Sold Batches List */}
            <div className="bg-white rounded-lg card-shadow overflow-hidden">
                <h3 className="text-lg font-semibold p-6 pb-0">Sold Batches</h3>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Colorway</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Skeins</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sale Price</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Profit</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Margin</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {soldBatches.slice().reverse().map(batch => (
                                <tr key={batch.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 text-sm">
                                        {DateUtils.formatDate(batch.soldDate || batch.startDate)}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="font-medium">{batch.colorway}</div>
                                        {batch.notes && (
                                            <div className="text-sm text-gray-500">{batch.notes}</div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-sm">{batch.skeins || 0}</td>
                                    <td className="px-6 py-4 text-sm font-semibold text-green-600">
                                        ${(batch.salePrice || 0).toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">
                                        ${(batch.totalCost || 0).toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 text-sm">
                                        <span className={batch.profit >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                                            ${(batch.profit || 0).toFixed(2)}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-sm">
                                        <span className={batch.profitMargin >= 0 ? 'text-purple-600 font-semibold' : 'text-red-600 font-semibold'}>
                                            {(batch.profitMargin || 0).toFixed(1)}%
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {soldBatches.length === 0 && (
                    <div className="text-center py-12 text-gray-400">
                        <p className="text-xl mb-2">💰</p>
                        <p>No batches sold yet. Move batches to "Sold" in the Pipeline!</p>
                    </div>
                )}
            </div>
        </div>
    );
}

// GradientCard Component (extracted for proper React hooks usage)
