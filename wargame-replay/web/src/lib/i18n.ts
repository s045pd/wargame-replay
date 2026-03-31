import { create } from 'zustand';

export type Locale = 'en' | 'zh';

const translations: Record<Locale, Record<string, string>> = {
  en: {
    // TopBar
    'games': 'Games',
    'app_title': 'MILSIM REPLAY',
    'players': 'players',
    'dark': 'Dark',
    'satellite': 'Satellite',
    'terrain': 'Terrain',
    'trails': 'Trails',
    'replay': 'Replay',
    'director': 'Director',

    // GameList
    'select_game': 'Select a Game',
    'choose_session': 'Choose a session to replay',
    'loading_games': 'Loading games\u2026',
    'no_games': 'No games found',
    'no_games_hint': 'Place .db files in the server directory.',
    'session': 'Session',
    'upload': 'Upload Game',
    'upload_hint': 'Drag & drop or click to upload .db + .txt files',
    'uploading': 'Uploading…',
    'upload_success': 'Upload successful',
    'upload_error': 'Upload failed',
    'upload_no_valid': 'No valid .db or .txt files selected',
    'upload_ok_count': '{n} file(s) imported',
    'upload_err_count': '{n} failed',
    'drop_here': 'Drop files here',
    'file_pattern_hint': '.db file + optional .txt (map metadata)',

    // TransportControls
    'speed': 'Speed',
    'immersive_hint': 'H = immersive',

    // Timeline tracks
    'hotspot': 'Hotspot',
    'camera': 'Camera',
    'bookmarks': 'Bookmarks',
    'clips': 'Clips',

    // Director
    'auto_director': 'Auto Director',
    'auto_on': 'Auto: ON',
    'auto_off': 'Auto: OFF',
    'next_switch': 'Next switch in',
    'ready': 'Ready',
    'recent_events': 'Recent Events',
    'no_events': 'No events yet',
    'preview': 'Preview',

    // Map
    'follow': 'Follow',
    'following': 'Following',
    'vs': 'vs',
    'deselect': 'Deselect',
    'auto_director_btn': 'Auto Director',
    'auto_director_on': 'Auto Director ON',

    // Unit classes
    'rifle': 'Rifleman',
    'mg': 'MG Gunner',
    'medic': 'Medic',
    'marksman': 'Marksman',
    'sniper': 'Sniper',

    // Hotspot types
    'firefight': 'Firefight',
    'killstreak': 'Killstreak',
    'mass_casualty': 'Mass Casualty',
    'engagement': 'Engagement',
    'bombardment': 'Bombardment',

    // Search
    'search': 'Search',
    'search_players': 'Search players',
    'search_placeholder': 'Player name or ID...',
    'search_hint': 'Type to search players',
    'no_results': 'No matching players',

    // Shortcuts
    'shortcut_help': 'Shortcuts',
    'shortcut_close': 'Close',
    'shortcut_playback': 'Playback',
    'shortcut_panels': 'Panels',
    'shortcut_display': 'Display',
    'sk_playpause': 'Play / Pause',
    'sk_tab': 'Toggle Replay / Director',
    'sk_auto': 'Toggle Auto Director',
    'sk_bookmark_panel': 'Toggle Bookmarks',
    'sk_bookmark_add': 'Add Bookmark',
    'sk_clips': 'Toggle Clips',
    'sk_search': 'Search Players',
    'sk_debug': 'Hotspot Debug Overlay',
    'sk_immersive': 'Immersive Mode',
    'sk_shortcuts': 'Show Shortcuts',

    // Recording
    'export_video': 'Video (.webm)',
    'export_video_desc': 'Record the map playback as a video file',
    'record_start': 'Start Recording',
    'recording': 'Recording…',
    'recording_preparing': 'Preparing…',
    'recording_done': 'Video Ready',
    'stop_recording': 'Stop',

    // Misc
    'score': 'score',
    'kills': 'kills',
    'hits': 'hits',
    'kia': 'KIA',
    'hp': 'HP',
    'kill_leader': 'Kill Leaders',
  },
  zh: {
    // TopBar
    'games': '游戏',
    'app_title': 'MILSIM REPLAY',
    'players': '名玩家',
    'dark': '暗色',
    'satellite': '卫星',
    'terrain': '地形',
    'trails': '轨迹',
    'replay': '回放',
    'director': '导播',

    // GameList
    'select_game': '选择游戏',
    'choose_session': '选择一个场次进行回放',
    'loading_games': '加载中\u2026',
    'no_games': '未找到游戏',
    'no_games_hint': '请将 .db 文件放置在服务器目录中。',
    'session': '场次',
    'upload': '上传对局',
    'upload_hint': '拖拽或点击上传 .db + .txt 文件（支持多文件）',
    'uploading': '上传中…',
    'upload_success': '上传成功',
    'upload_error': '上传失败',
    'upload_no_valid': '未选择有效的 .db 或 .txt 文件',
    'upload_ok_count': '{n} 个文件导入成功',
    'upload_err_count': '{n} 个失败',
    'drop_here': '拖放文件到此处',
    'file_pattern_hint': '.db 游戏文件 + 可选 .txt 地图元数据',

    // TransportControls
    'speed': '倍速',
    'immersive_hint': 'H = 沉浸模式',

    // Timeline tracks
    'hotspot': '热点',
    'camera': '镜头',
    'bookmarks': '书签',
    'clips': '片段',

    // Director
    'auto_director': '自动导播',
    'auto_on': '自动: 开启',
    'auto_off': '自动: 关闭',
    'next_switch': '下次切换',
    'ready': '就绪',
    'recent_events': '最近事件',
    'no_events': '暂无事件',
    'preview': '预览',

    // Map
    'follow': '跟随',
    'following': '跟随中',
    'vs': 'vs',
    'deselect': '取消选择',
    'auto_director_btn': '自动导播',
    'auto_director_on': '自动导播 开启',

    // Unit classes
    'rifle': '步枪兵',
    'mg': '机枪兵',
    'medic': '医疗兵',
    'marksman': '精确射手',
    'sniper': '狙击手',

    // Hotspot types
    'firefight': '交火',
    'killstreak': '连杀',
    'mass_casualty': '大规模伤亡',
    'engagement': '大规模交火',
    'bombardment': '轰炸',

    // Search
    'search': '搜索',
    'search_players': '搜索玩家',
    'search_placeholder': '输入玩家名或 ID...',
    'search_hint': '输入关键字搜索玩家',
    'no_results': '无匹配玩家',

    // Shortcuts
    'shortcut_help': '快捷键',
    'shortcut_close': '关闭',
    'shortcut_playback': '回放控制',
    'shortcut_panels': '面板',
    'shortcut_display': '显示',
    'sk_playpause': '播放 / 暂停',
    'sk_tab': '切换 回放 / 导播',
    'sk_auto': '切换自动导播',
    'sk_bookmark_panel': '切换书签面板',
    'sk_bookmark_add': '添加书签',
    'sk_clips': '切换片段面板',
    'sk_search': '搜索玩家',
    'sk_debug': '热点调试覆盖层',
    'sk_immersive': '沉浸模式',
    'sk_shortcuts': '显示快捷键',

    // Recording
    'export_video': '视频 (.webm)',
    'export_video_desc': '将地图回放录制为视频文件',
    'record_start': '开始录制',
    'recording': '录制中…',
    'recording_preparing': '准备中…',
    'recording_done': '视频已就绪',
    'stop_recording': '停止',

    // Misc
    'score': '分数',
    'kills': '击杀',
    'hits': '命中',
    'kia': '阵亡',
    'hp': '生命值',
    'kill_leader': '击杀榜',
  },
};

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

export const useI18n = create<I18nState>((set, get) => ({
  locale: 'zh',
  setLocale: (locale) => set({ locale }),
  t: (key: string) => {
    const { locale } = get();
    return translations[locale][key] ?? translations.en[key] ?? key;
  },
}));
