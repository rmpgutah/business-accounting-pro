export default function Skeleton() {
  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-8" aria-busy="true" aria-label="Loading invoice">
      <div className="max-w-4xl mx-auto bg-white border-2 border-gray-900">
        <div className="bg-gray-900 p-6 sm:p-8 flex flex-col sm:flex-row justify-between gap-6">
          <div className="space-y-3 w-full sm:w-1/2">
            <div className="h-8 bg-gray-700 animate-pulse w-3/4" />
            <div className="h-3 bg-gray-700 animate-pulse w-1/2" />
            <div className="h-3 bg-gray-700 animate-pulse w-2/3" />
          </div>
          <div className="space-y-3 w-full sm:w-1/3">
            <div className="h-3 bg-gray-700 animate-pulse w-1/3 ml-auto" />
            <div className="h-7 bg-gray-700 animate-pulse w-2/3 ml-auto" />
            <div className="h-3 bg-gray-700 animate-pulse w-1/2 ml-auto" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 border-b-2 border-gray-900">
          <div className="p-6 border-r-0 sm:border-r-2 border-gray-900 space-y-3">
            <div className="h-3 bg-gray-200 animate-pulse w-1/3" />
            <div className="h-5 bg-gray-200 animate-pulse w-2/3" />
            <div className="h-4 bg-gray-200 animate-pulse w-1/2" />
          </div>
          <div className="p-6 space-y-3">
            <div className="h-3 bg-gray-200 animate-pulse w-1/3" />
            <div className="h-5 bg-gray-200 animate-pulse w-2/3" />
            <div className="h-4 bg-gray-200 animate-pulse w-1/2" />
          </div>
        </div>
        <div className="p-6 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 bg-gray-100 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
