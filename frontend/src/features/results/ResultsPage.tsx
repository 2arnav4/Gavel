import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CheckCircle, AlertCircle, Clock, Home, Award, DollarSign } from "lucide-react";
import { PageContainer } from "../../components/ui/PageContainer";
import { Button } from "../../components/ui/Button";
import { getRoomResults, type AuctionItem } from "../../services/api";
import { getErrorMessage } from "../../utils/error";

export function ResultsPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [results, setResults] = useState<AuctionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;

    const fetchResults = async () => {
      try {
        setLoading(true);
        const data = await getRoomResults(code);
        setResults(data);
      } catch (err: unknown) {
        console.error("Failed to load results:", err);
        setError(getErrorMessage(err, "Failed to fetch auction results."));
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, [code]);

  const handleBackToHome = () => {
    navigate("/");
  };

  if (loading) {
    return (
      <PageContainer className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="relative flex h-12 w-12 items-center justify-center">
            <div className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/20 opacity-75" />
            <div className="relative rounded-full h-8 w-8 bg-accent/20 flex items-center justify-center">
              <Clock className="h-4 w-4 text-accent animate-spin" />
            </div>
          </div>
          <p className="text-sm text-text-secondary">Loading final auction results...</p>
        </div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer className="px-4 py-12 sm:px-6 sm:py-16">
        <div className="border border-border bg-surface-raised/40 p-8 rounded-xl text-center max-w-md mx-auto space-y-6 shadow-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-400">
            <AlertCircle className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-text-primary">Error Fetching Results</h2>
            <p className="text-sm text-text-secondary leading-relaxed">{error}</p>
          </div>
          <Button variant="secondary" onClick={handleBackToHome} className="w-full">
            Back to Home
          </Button>
        </div>
      </PageContainer>
    );
  }

  // Calculate statistics
  const soldItems = results.filter((item) => item.status === "sold");
  const unsoldItemsCount = results.filter((item) => item.status === "unsold").length;
  const totalRevenue = soldItems.reduce((acc, curr) => acc + curr.currentBid, 0);

  return (
    <PageContainer className="px-4 py-12 sm:px-6 sm:py-16 max-w-4xl">
      <div className="space-y-8">
        
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 border border-green-500/20 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-green-400 uppercase">
              <CheckCircle className="h-3 w-3" />
              Auction Completed
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
              Final Auction Results
            </h1>
            <p className="text-xs text-text-secondary leading-relaxed">
              Room Code: <span className="font-mono text-accent font-semibold">{code?.toUpperCase()}</span>
            </p>
          </div>

          <Button
            variant="secondary"
            onClick={handleBackToHome}
            className="self-start sm:self-center border border-border/50 text-xs"
          >
            <Home className="h-3.5 w-3.5" />
            Back to Home
          </Button>
        </div>

        {/* Stats Summary Panel */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          {/* Revenue */}
          <div className="border border-border bg-surface-raised/40 p-4 rounded-xl flex items-center gap-4 shadow-sm relative overflow-hidden">
            <div className="p-3 bg-green-500/10 border border-green-500/20 text-green-400 rounded-lg shrink-0">
              <DollarSign className="h-5 w-5" />
            </div>
            <div>
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block">
                Total Revenue
              </span>
              <span className="text-lg font-bold text-text-primary">
                ₹{totalRevenue.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Sold Count */}
          <div className="border border-border bg-surface-raised/40 p-4 rounded-xl flex items-center gap-4 shadow-sm relative overflow-hidden">
            <div className="p-3 bg-accent/10 border border-accent/20 text-accent rounded-lg shrink-0">
              <Award className="h-5 w-5" />
            </div>
            <div>
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block">
                Items Sold
              </span>
              <span className="text-lg font-bold text-text-primary">
                {soldItems.length} / {results.length}
              </span>
            </div>
          </div>

          {/* Unsold Count */}
          <div className="border border-border bg-surface-raised/40 p-4 rounded-xl flex items-center gap-4 shadow-sm relative overflow-hidden">
            <div className="p-3 bg-zinc-500/10 border border-border text-text-muted rounded-lg shrink-0">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block">
                Items Unsold
              </span>
              <span className="text-lg font-bold text-text-primary">
                {unsoldItemsCount}
              </span>
            </div>
          </div>
        </div>

        {/* Results Catalog Table */}
        <div className="border border-border bg-surface-raised/40 rounded-xl overflow-hidden shadow-lg">
          <div className="p-5 border-b border-border/40 bg-surface-raised/60">
            <h3 className="text-sm font-semibold text-text-primary">Resolved Items Summary</h3>
          </div>

          {results.length === 0 ? (
            <div className="py-12 text-center text-text-muted space-y-2">
              <AlertCircle className="h-8 w-8 mx-auto stroke-[1.5]" />
              <p className="text-sm font-medium">No items were resolved in this auction.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border bg-surface-overlay/30 text-[10px] uppercase font-semibold text-text-muted">
                    <th className="px-6 py-3">Item Details</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Winner</th>
                    <th className="px-6 py-3 text-right">Final Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 text-xs">
                  {results.map((item) => (
                    <tr key={item._id} className="hover:bg-surface-overlay/20 transition-colors">
                      <td className="px-6 py-4">
                        <span className="font-semibold text-text-primary block">{item.name}</span>
                        {item.description && (
                          <span className="text-[10px] text-text-muted block mt-0.5 line-clamp-1">
                            {item.description}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {item.status === "sold" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 border border-green-500/20 px-2 py-0.5 text-[10px] font-medium text-green-400">
                            Sold
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-400">
                            Unsold
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 font-medium text-text-secondary">
                        {item.status === "sold" && item.highestBidderUsername ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-4.5 w-4.5 rounded-full bg-accent/10 text-accent flex items-center justify-center font-bold text-[8px]">
                              {item.highestBidderUsername.charAt(0).toUpperCase()}
                            </span>
                            {item.highestBidderUsername}
                          </span>
                        ) : (
                          <span className="text-text-muted font-normal">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-text-primary">
                        {item.status === "sold" ? (
                          <span className="text-accent">₹{(item.currentBid ?? item.startingBid ?? 0).toLocaleString()}</span>
                        ) : (
                          <span className="text-text-muted font-normal">₹{(item.startingBid ?? 0).toLocaleString()}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </PageContainer>
  );
}
