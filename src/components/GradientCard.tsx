import React, { useState } from 'react';

export function GradientCard({ gradient, editGradient, deleteGradient, DOS_LEVELS, SQUARE_AMOUNTS, calculateDosML }) {
    const [expanded, setExpanded] = React.useState(false);
    const [photoIndex, setPhotoIndex] = React.useState(0);

    const photos = gradient.photos && gradient.photos.length > 0
        ? gradient.photos
        : gradient.photo
            ? [{ id: 1, data: gradient.photo, label: 'Photo' }]
            : [];
    const currentIdx = Math.min(photoIndex, photos.length - 1);

    return (
        <div className="bg-white rounded-lg card-shadow p-4">
            <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                    {gradient.gradientId && (
                        <p className="text-xs font-semibold text-purple-600 mb-1">{gradient.gradientId}</p>
                    )}
                    <h3 className="text-lg font-semibold text-gray-900">{gradient.name}</h3>
                    <div className="flex flex-wrap gap-2 items-center mt-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            gradient.type === 'dos' 
                                ? 'bg-purple-100 text-purple-700' 
                                : 'bg-blue-100 text-blue-700'
                        }`}>
                            {gradient.type === 'dos' ? '🎨 DOS' : '🔲 Dye Square'}
                        </span>
                        <span className="text-xs text-gray-500">{gradient.skeinWeight || 10}g skeins</span>
                    </div>
                    <div className="mt-1">
                        {gradient.type === 'dos' ? (
                            <p className="text-sm text-gray-700">
                                <span className="font-medium">{gradient.dyeColor}</span>
                                <span className="text-gray-400"> on </span>
                                <span>{gradient.yarnBase}</span>
                            </p>
                        ) : (
                            <p className="text-sm text-gray-700">
                                <span className="font-medium">{gradient.colorA}</span>
                                <span className="text-gray-400"> × </span>
                                <span className="font-medium">{gradient.colorB}</span>
                                <span className="text-gray-400"> on </span>
                                <span>{gradient.yarnBase}</span>
                            </p>
                        )}
                    </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => editGradient(gradient)} className="text-blue-600 hover:bg-blue-50 px-2 py-1 rounded text-sm">✏️</button>
                    <button onClick={() => deleteGradient(gradient.id)} className="text-red-600 hover:bg-red-50 px-2 py-1 rounded text-sm">🗑️</button>
                </div>
            </div>

            {/* Photo Gallery */}
            {photos.length > 0 && (
                <div className="mb-3">
                    <div className="relative">
                        <img src={photos[currentIdx].data} alt={photos[currentIdx].label || gradient.name}
                            className="rounded-lg w-full" style={{maxHeight: '200px', objectFit: 'cover'}} />
                        {photos.length > 1 && (
                            <React.Fragment>
                                <button onClick={(e) => { e.stopPropagation(); setPhotoIndex(currentIdx > 0 ? currentIdx - 1 : photos.length - 1); }}
                                    className="absolute left-1 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-opacity-70">◀</button>
                                <button onClick={(e) => { e.stopPropagation(); setPhotoIndex(currentIdx < photos.length - 1 ? currentIdx + 1 : 0); }}
                                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-opacity-70">▶</button>
                            </React.Fragment>
                        )}
                    </div>
                    {photos.length > 1 && (
                        <div className="flex items-center justify-center gap-1 mt-1.5">
                            {photos.map((p, i) => (
                                <button key={p.id || i} onClick={() => setPhotoIndex(i)}
                                    className={`w-1.5 h-1.5 rounded-full transition-colors ${i === currentIdx ? 'bg-purple-600' : 'bg-gray-300 hover:bg-gray-400'}`} />
                            ))}
                        </div>
                    )}
                    {photos[currentIdx].label && photos[currentIdx].label !== 'Photo' && (
                        <p className="text-xs text-center text-gray-500 mt-0.5">{photos[currentIdx].label}</p>
                    )}
                </div>
            )}

            {/* Expandable Details */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full text-left text-sm text-purple-600 hover:text-purple-700 font-medium mt-1 mb-1"
            >
                {expanded ? '▼ Hide' : '▶ Show'} {gradient.type === 'dos' ? 'Shade Table' : 'Grid'} 
                {gradient.type === 'dos' ? ' (10 shades)' : ' (25 squares)'}
            </button>

            {expanded && gradient.type === 'dos' && (
                <div className="bg-purple-50 rounded-lg p-2 mt-1 overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-purple-200">
                                <th className="text-left py-1 px-1 text-purple-700">Shade</th>
                                <th className="text-right py-1 px-1 text-purple-700">DOS %</th>
                                <th className="text-right py-1 px-1 text-purple-700">mL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(gradient.shades || DOS_LEVELS.map(dos => ({ dos, ml: calculateDosML(dos, gradient.skeinWeight || 10) }))).map((shade, i) => (
                                <tr key={i} className={i % 2 === 0 ? 'bg-purple-50' : 'bg-white'}>
                                    <td className="py-0.5 px-1 text-gray-700">Shade {i + 1}</td>
                                    <td className="py-0.5 px-1 text-right text-gray-700">{shade.dos}%</td>
                                    <td className="py-0.5 px-1 text-right font-medium text-purple-700">{shade.ml} mL</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {expanded && gradient.type === 'dyeSquare' && (
                <div className="bg-blue-50 rounded-lg p-2 mt-1 overflow-x-auto">
                    <div className="text-xs mb-1">
                        <span className="font-medium text-blue-700">A: {gradient.colorA}</span>
                        <span className="text-gray-400 mx-1">×</span>
                        <span className="font-medium text-blue-700">B: {gradient.colorB}</span>
                    </div>
                    <table className="w-full text-xs">
                        <thead>
                            <tr>
                                <th className="py-1 px-1 text-blue-700 text-left" style={{minWidth: '55px'}}>A↓ B→</th>
                                {SQUARE_AMOUNTS.map(b => (
                                    <th key={b} className="py-1 px-1 text-center text-blue-700" style={{minWidth: '40px'}}>{b}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {SQUARE_AMOUNTS.map((a, ri) => (
                                <tr key={a} className={ri % 2 === 0 ? 'bg-blue-50' : 'bg-white'}>
                                    <td className="py-0.5 px-1 font-medium text-blue-700">{a}</td>
                                    {SQUARE_AMOUNTS.map(b => (
                                        <td key={b} className="py-0.5 px-1 text-center text-gray-600">
                                            {((a + b) / (gradient.skeinWeight || 10)).toFixed(gradient.skeinWeight === 10 ? 2 : 4)}%
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {gradient.notes && expanded && (
                <div className="mt-2 text-xs text-gray-600 bg-gray-50 rounded p-2">
                    <span className="font-medium text-gray-700">Notes: </span>{gradient.notes}
                </div>
            )}

            <p className="text-xs text-gray-400 pt-2">
                Created: {new Date(gradient.created).toLocaleDateString()}
            </p>
        </div>
    );
}

// Gradients Component
