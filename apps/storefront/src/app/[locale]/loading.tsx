/** Streaming placeholder while a page's data resolves. */
export default function Loading() {
  return (
    <div className="shell py-section">
      <div className="jk-skeleton h-12 w-2/3 max-w-xl rounded-sm" />
      <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index}>
            <div className="jk-skeleton aspect-[4/5] rounded-sm" />
            <div className="jk-skeleton mt-3 h-4 w-3/4 rounded-sm" />
            <div className="jk-skeleton mt-2 h-4 w-1/3 rounded-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
