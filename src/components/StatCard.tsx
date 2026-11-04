

export function StatCard({ title, value, icon, color, onClick = undefined }: { title: string; value: any; icon: string; color: string; onClick?: () => void }) {
    const colors = {
        purple: 'bg-teal-50 text-teal-700',
        blue: 'bg-blue-50 text-blue-700',
        green: 'bg-green-50 text-green-700',
        red: 'bg-red-50 text-red-700'
    };

    // Clickable cards open the page behind the number.
    const Tag = onClick ? 'button' : 'div';
    return (
        <Tag onClick={onClick} className={`bg-white rounded-lg card-shadow p-6 w-full text-left ${onClick ? 'hover:bg-gray-50' : ''}`}>
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm text-gray-600 mb-1">{title}</p>
                    <p className="text-3xl font-bold text-gray-900">{value}</p>
                </div>
                <div className={`text-4xl p-3 rounded-lg ${colors[color]}`}>
                    {icon}
                </div>
            </div>
        </Tag>
    );
}
