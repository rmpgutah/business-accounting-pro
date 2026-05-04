interface ErrorStateProps {
  status?: number;
  message?: string;
  companyName?: string;
}

export default function ErrorState({ status, message, companyName }: ErrorStateProps) {
  let title = 'Something went wrong';
  let body = message || 'An unexpected error occurred while loading this invoice.';

  if (status === 404) {
    title = 'Invoice not found';
    body = `This invoice could not be located. The link may be incorrect.${
      companyName ? ` Please contact ${companyName} for a new link.` : ' Please contact the sender for a new link.'
    }`;
  } else if (status === 410) {
    title = 'This invoice link has expired';
    body = `For your security, invoice links expire after a period of time.${
      companyName ? ` Please contact ${companyName} to request a new link.` : ' Please contact the sender to request a new link.'
    }`;
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <article className="bg-white border-2 border-gray-900 p-8 max-w-md w-full">
        <div className="border-b-2 border-gray-900 pb-4 mb-4">
          <p className="text-xs font-black uppercase tracking-widest text-gray-500">
            {status ? `Error ${status}` : 'Error'}
          </p>
          <h1 className="text-2xl font-black uppercase tracking-tight mt-1">{title}</h1>
        </div>
        <p className="text-gray-700 leading-relaxed">{body}</p>
      </article>
    </div>
  );
}
