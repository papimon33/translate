import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import IconButton from '@mui/material/IconButton';
import Avatar from '@mui/material/Avatar';
import Chip from '@mui/material/Chip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Select from '@mui/material/Select';
import { alpha } from '@mui/material/styles';
import { MULTI_LANGS, OUT_LANGS } from '../theme.js';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import { api } from '../api.js';

function rel(ts) {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return new Date(ts).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

export default function SessionList({ onOpen }) {
  const [list, setList] = useState(null);
  const [dlg, setDlg] = useState(false);
  const [name, setName] = useState('');
  const [pipeline, setPipeline] = useState('whisper');
  const [menu, setMenu] = useState(null);

  const reload = () => api.list().then(setList);
  useEffect(() => {
    reload();
  }, []);

  const openDlg = () => {
    setName('');
    setPipeline('whisper');
    setDlg(true);
  };

  const create = async () => {
    setDlg(false);
    const s = await api.create({ title: name.trim() || '새 세션', pipeline, inLang: 'auto' });
    onOpen(s);
  };

  const exportSession = async () => {
    const s = await api.get(menu.session.id);
    setMenu(null);
    const lines = s.items.map((it) => {
      const who = it.side === 'left' ? '[시스템]' : '[마이크]';
      const txt = it.texts ? Object.values(it.texts).join(' / ') : it.text || '';
      return who + ' ' + txt + (it.source ? `  (${it.source})` : '');
    });
    const text = `${s.title}\n${new Date(s.createdAt).toLocaleString('ko-KR')}\n\n` + lines.join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (s.title || 'session').replace(/[\\/:*?"<>|]/g, '_') + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const removeSession = async () => {
    const id = menu.session.id;
    setMenu(null);
    if (!confirm('이 세션을 삭제할까요?')) return;
    await api.remove(id);
    reload();
  };

  const empty = list && list.length === 0;

  return (
    <>
      {/* 헤더 */}
      <Box sx={{ px: 4, py: 2.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'flex-end', gap: 2 }}>
        <Box>
          <Typography variant="h6">실시간 번역</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25 }}>
            세션을 열어 이어보거나 새로 시작하세요.
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={openDlg}>
          새 세션
        </Button>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', p: 4 }}>
        <Box sx={{ maxWidth: 860, mx: 'auto' }}>
          {empty && (
            <Box sx={{ textAlign: 'center', mt: 8, color: 'text.secondary' }}>
              <Avatar
                sx={{
                  width: 76, height: 76, mx: 'auto', mb: 2.5,
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
                  color: 'primary.main',
                }}
              >
                <RecordVoiceOverIcon sx={{ fontSize: 38 }} />
              </Avatar>
              <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary' }}>아직 세션이 없어요</Typography>
              <Typography sx={{ fontSize: 14, mt: 0.75, mb: 3 }}>
                새 세션을 만들고 외국어를 실시간으로 번역해 보세요.
              </Typography>
              <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={openDlg}>
                새 세션 만들기
              </Button>
            </Box>
          )}

          {(list || []).map((s) => (
            <Card
              key={s.id}
              sx={{
                mb: 1.5,
                display: 'flex',
                alignItems: 'center',
                '&:hover': { transform: 'translateY(-2px)', boxShadow: 6, borderColor: 'primary.main' },
              }}
            >
              <CardActionArea onClick={() => onOpen(s)} sx={{ px: 2, py: 1.75, display: 'flex', justifyContent: 'flex-start', gap: 1.75 }}>
                <Avatar
                  variant="rounded"
                  sx={{
                    width: 44, height: 44,
                    bgcolor: (t) => alpha(t.palette.primary.main, 0.14),
                    color: 'primary.main',
                  }}
                >
                  <ForumOutlinedIcon />
                </Avatar>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 15.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title || '(제목 없음)'}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                    <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{rel(s.updatedAt)}</Typography>
                    <Chip size="small" label={`${s.count}문장`} sx={{ height: 20, fontSize: 11 }} />
                  </Box>
                </Box>
              </CardActionArea>
              <IconButton sx={{ mr: 1 }} onClick={(e) => setMenu({ anchor: e.currentTarget, session: s })}>
                <MoreVertIcon />
              </IconButton>
            </Card>
          ))}
        </Box>
      </Box>

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={exportSession}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          대화내역 저장
        </MenuItem>
        <MenuItem onClick={removeSession} sx={{ color: 'error.main' }}>
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" sx={{ color: 'error.main' }} />
          </ListItemIcon>
          삭제
        </MenuItem>
      </Menu>

      <Dialog open={dlg} onClose={() => setDlg(false)} PaperProps={{ sx: { width: 440, maxWidth: '92vw' } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>새 세션</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            placeholder="세션 이름 (비우면 첫 문장으로 자동)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />

          <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mt: 2.5, mb: 1 }}>번역 방식</Typography>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={pipeline}
            onChange={(e, v) => v && setPipeline(v)}
            color="primary"
          >
            <ToggleButton value="whisper" sx={{ textTransform: 'none', flexDirection: 'column', py: 1.2 }}>
              <b>Whisper</b>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>다국어 · 저비용</Typography>
            </ToggleButton>
            <ToggleButton value="translate" sx={{ textTransform: 'none', flexDirection: 'column', py: 1.2 }}>
              <b>Translate</b>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>단일 · 고품질</Typography>
            </ToggleButton>
          </ToggleButtonGroup>
          <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 0.75 }}>
            ※ 번역 방식은 생성 후 변경할 수 없습니다. {pipeline === 'whisper' ? '출력 언어는 화면에서 선택합니다(한·영·일·중).' : '출력 언어는 화면에서 선택합니다.'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDlg(false)}>취소</Button>
          <Button variant="contained" onClick={create}>
            만들기
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
