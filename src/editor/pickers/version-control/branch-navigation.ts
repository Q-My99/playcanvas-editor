/** Pin a deliberate branch switch before refresh, keeping unrelated query options. */
export const branchNavigationUrl = (currentUrl: string, branchId: string) => {
    const url = new URL(currentUrl);
    url.searchParams.set('branchId', branchId);
    return `${url.pathname}${url.search}${url.hash}`;
};

/** Explicit branch pages are stable tabs, not mirrors of another tab's checkout. */
export const shouldRefreshForCheckout = (currentUrl: string, loadedBranchId: string, checkoutBranchId: string) => {
    const pinned = new URL(currentUrl).searchParams.get('branchId');
    return !pinned && checkoutBranchId !== loadedBranchId;
};
