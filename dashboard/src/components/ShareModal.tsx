import { useState, useEffect } from 'react';
import html2canvas from 'html2canvas';
import { esc } from '@/utils';
import { useStore } from '@/state';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

function buildShareCard(name: string, summary: string, timestamp: string): HTMLDivElement {
  const card = document.createElement('div');
  card.style.cssText = 'position:fixed;left:-9999px;top:0;width:1200px;height:630px;background:#f8f7f4;font-family:"DM Sans",system-ui,sans-serif;overflow:hidden;';

  const ts = timestamp
    ? new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  card.innerHTML = ''
    + '<div style="position:absolute;inset:0;opacity:0.045;background:repeating-conic-gradient(#000 0% 25%, transparent 0% 50%) 0 0/4px 4px;pointer-events:none;"></div>'
    + '<div style="position:absolute;top:0;left:0;right:0;height:5px;background:#2d8a56;"></div>'
    + '<div style="padding:44px 50px;display:flex;flex-direction:column;height:100%;box-sizing:border-box;">'
    +   '<div style="display:flex;align-items:center;gap:7px;margin-bottom:28px;">'
    +     '<span style="width:7px;height:7px;background:#2d8a56;border-radius:50%;display:inline-block;"></span>'
    +     '<span style="font-size:16px;color:#a3a3a3;font-weight:500;letter-spacing:0.04em;">openseed</span>'
    +   '</div>'
    +   '<div style="flex:1;display:flex;flex-direction:column;justify-content:center;">'
    +     '<div style="font-family:Newsreader,Georgia,serif;font-size:48px;font-weight:600;color:#2d8a56;letter-spacing:-0.02em;margin-bottom:16px;">' + esc(name) + '</div>'
    +     '<div style="font-family:Newsreader,Georgia,serif;font-size:36px;line-height:1.6;color:#2a2a2a;font-weight:400;letter-spacing:-0.005em;max-width:1100px;">'
    +       esc(summary).replace(/`([^`]+)`/g, '<code style="background:#edeae4;padding:1px 6px;border-radius:3px;font-family:SF Mono,Fira Code,monospace;font-size:30px;">$1</code>')
    +     '</div>'
    +   '</div>'
    +   '<div style="border-top:1px solid #e5e0d8;padding-top:14px;display:flex;justify-content:space-between;align-items:center;">'
    +     '<span style="font-size:14px;color:#c4c0b8;">' + esc(ts) + '</span>'
    +     '<span style="font-size:14px;color:#a3a3a3;letter-spacing:0.02em;">openseed.dev</span>'
    +   '</div>'
    + '</div>';

  document.body.appendChild(card);
  return card;
}

async function generateShareImage(name: string, summary: string, timestamp: string): Promise<HTMLCanvasElement> {
  const card = buildShareCard(name, summary, timestamp);
  try {
    return await html2canvas(card, {
      width: 1200, height: 630, scale: 2,
      backgroundColor: '#f8f7f4',
      logging: false, useCORS: true,
    });
  } finally {
    card.remove();
  }
}

async function copyCanvasToClipboard(canvas: HTMLCanvasElement): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error('no blob')); return; }
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        resolve();
      } catch (e) { reject(e); }
    }, 'image/png');
  });
}

export function ShareModal() {
  const data = useStore(s => s.shareData);
  const setShareData = useStore(s => s.setShareData);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [imgSrc, setImgSrc] = useState('');
  const [tweetText, setTweetText] = useState('');
  const [feedback, setFeedback] = useState('');
  const [copyLabel, setCopyLabel] = useState('Copy image');

  useEffect(() => {
    if (!data) { setCanvas(null); setImgSrc(''); return; }
    setTweetText('Look what my agent did!\n\nhttps://openseed.dev');
    setCopyLabel('Copy image');
    setFeedback('');

    generateShareImage(data.name, data.summary, data.t)
      .then(c => {
        setCanvas(c);
        setImgSrc(c.toDataURL('image/png'));
      })
      .catch(() => setImgSrc(''));
  }, [data]);

  const close = () => setShareData(null);

  const copyImage = async () => {
    if (!canvas) return;
    try {
      await copyCanvasToClipboard(canvas);
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy image'), 2000);
    } catch {
      setCopyLabel('Copy failed');
    }
  };

  const downloadImage = () => {
    if (!canvas || !data) return;
    const a = document.createElement('a');
    a.download = `openseed-${data.name}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  const shareToTwitter = async () => {
    if (canvas) {
      try {
        await copyCanvasToClipboard(canvas);
        setFeedback('Image copied!');
      } catch {
        setFeedback('Could not copy image — download it instead');
      }
    }
    window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(tweetText), '_blank');
  };

  const charCount = tweetText.length;

  return (
    <Dialog open={!!data} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-[640px] max-h-[90vh] overflow-y-auto p-7">
        <div className="mb-2 text-center text-text-dim text-xs">
          {imgSrc
            ? <img src={imgSrc} className="w-full border border-border-default" />
            : 'Generating image...'
          }
        </div>

        {imgSrc && (
          <div className="flex gap-4 justify-center mb-5">
            <span className="text-[11px] text-text-dim cursor-pointer hover:text-narrator" onClick={copyImage}>{copyLabel}</span>
            <span className="text-[11px] text-text-dim cursor-pointer hover:text-narrator" onClick={downloadImage}>Download image</span>
          </div>
        )}

        <div className="flex border-b border-border-default mb-4">
          <button className="px-4 py-2 text-narrator text-xs border-b-2 border-narrator bg-transparent font-sans">Twitter</button>
        </div>

        <textarea
          className="w-full min-h-[100px] resize-y font-sans text-[13px] border border-border-default p-3 text-text-primary bg-bg leading-relaxed focus:outline-none focus:border-narrator rounded"
          value={tweetText}
          onChange={(e) => setTweetText(e.target.value)}
        />
        <div className={`text-[10px] text-right mt-1 ${charCount > 280 ? 'text-error' : charCount > 250 ? 'text-warn-light' : 'text-text-dim'}`}>
          {charCount} / 280
        </div>

        <Button variant="outline" className="mt-3 border-narrator text-narrator hover:bg-[#f0fdf4]" onClick={shareToTwitter}>
          Copy image and open Twitter
        </Button>
        {feedback && <span className="text-[11px] text-narrator ml-3">{feedback}</span>}
        <div className="text-[11px] text-text-dim mt-2">Paste the image in the compose window</div>
      </DialogContent>
    </Dialog>
  );
}
