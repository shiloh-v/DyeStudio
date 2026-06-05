import { StatCard } from './StatCard';
import { isStocked } from '../lib/batches';
import { isLowStock, lowStockLabel } from '../lib/lowStock';

export function Dashboard({ recipes, inventory, batches, sales }) {
    const activeBatches = batches.filter(b => !isStocked(b)).length;
    const lowStock = inventory.filter(isLowStock).length;

    // Projected value/profit from finished stock (not realized sales — those come from Shopify later)
    const stocked = batches.filter(isStocked);
    const totalRevenue = stocked.reduce((sum, b) => sum + (b.salePrice || 0), 0);
    const totalProfit = stocked.reduce((sum, b) => sum + (b.profit || 0), 0);
    const avgProfitMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100) : 0;
    
    const thisMonthSales = sales.filter(s => {
        const saleDate = new Date(s.date);
        const now = new Date();
        return saleDate.getMonth() === now.getMonth() && saleDate.getFullYear() === now.getFullYear();
    }).length;

    const statusCounts = batches.reduce((acc, batch) => {
        acc[batch.status] = (acc[batch.status] || 0) + 1;
        return acc;
    }, {});

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Studio Overview</h2>
            
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <StatCard 
                    title="Total Recipes" 
                    value={recipes.length} 
                    icon="📝"
                    color="purple"
                />
                <StatCard 
                    title="Active Batches" 
                    value={activeBatches} 
                    icon="🔄"
                    color="blue"
                />
                <StatCard 
                    title="Low Stock Items" 
                    value={lowStock} 
                    icon="⚠️"
                    color={lowStock > 0 ? "red" : "green"}
                />
                <StatCard
                    title="Projected Revenue"
                    value={`$${totalRevenue.toFixed(2)}`}
                    icon="🏷️"
                    color="green"
                />
                <StatCard
                    title="Projected Profit"
                    value={`$${totalProfit.toFixed(2)}`}
                    icon="📈"
                    color={totalProfit >= 0 ? "green" : "red"}
                />
                <StatCard
                    title="Avg Margin"
                    value={`${avgProfitMargin.toFixed(1)}%`}
                    icon="📊"
                    color={avgProfitMargin >= 30 ? "green" : avgProfitMargin >= 15 ? "yellow" : "red"}
                />
            </div>

            {/* Pipeline Status */}
            <div className="bg-white rounded-lg card-shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Production Pipeline</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-4 bg-yellow-50 rounded-lg">
                        <div className="text-3xl font-bold text-yellow-700">{statusCounts.dyeing || 0}</div>
                        <div className="text-sm text-yellow-600 mt-1">Dyeing</div>
                    </div>
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                        <div className="text-3xl font-bold text-blue-700">{statusCounts.drying || 0}</div>
                        <div className="text-sm text-blue-600 mt-1">Drying</div>
                    </div>
                    <div className="text-center p-4 bg-green-50 rounded-lg">
                        <div className="text-3xl font-bold text-green-700">{statusCounts.ready || 0}</div>
                        <div className="text-sm text-green-600 mt-1">Ready for Labels</div>
                    </div>
                    <div className="text-center p-4 bg-teal-50 rounded-lg">
                        <div className="text-3xl font-bold text-teal-700">{batches.filter(isStocked).length}</div>
                        <div className="text-sm text-teal-600 mt-1">Stocked</div>
                    </div>
                </div>
            </div>

            {/* Recent Activity */}
            <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-white rounded-lg card-shadow p-6">
                    <h3 className="text-lg font-semibold mb-4">Recent Sales</h3>
                    {sales.length > 0 ? (
                        <div className="space-y-2">
                            {sales.slice(-5).reverse().map((sale, idx) => (
                                <div key={idx} className="flex justify-between items-center py-2 border-b">
                                    <div>
                                        <div className="font-medium">{sale.colorway}</div>
                                        <div className="text-sm text-gray-500">{sale.customer}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-semibold text-green-600">${sale.amount}</div>
                                        <div className="text-xs text-gray-400">{new Date(sale.date).toLocaleDateString()}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-400 text-center py-8">No sales yet</p>
                    )}
                </div>

                <div className="bg-white rounded-lg card-shadow p-6">
                    <h3 className="text-lg font-semibold mb-4">Low Stock Alert</h3>
                    {lowStock > 0 ? (
                        <div className="space-y-2">
                            {inventory.filter(isLowStock).map((item, idx) => (
                                <div key={idx} className="flex justify-between items-center p-3 bg-red-50 rounded border-l-4 border-red-500">
                                    <div>
                                        <div className="font-medium">{item.name}</div>
                                        <div className="text-sm text-gray-600">{item.category}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-semibold text-red-600">{item.quantity} {item.unit}</div>
                                        <div className="text-xs text-gray-500">Min: {lowStockLabel(item)}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-400 text-center py-8">All items well stocked ✓</p>
                    )}
                </div>
            </div>
        </div>
    );
}
