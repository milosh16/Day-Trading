export default function Loading() {
  return (
    <div className="px-4 pt-14 flex flex-col items-center justify-center min-h-[60vh]">
      <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin mb-4" />
      <p className="text-sm text-gray-400">Loading...</p>
    </div>
  );
}
