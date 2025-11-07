import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormArray, FormControl } from '@angular/forms';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';
import { Timestamp } from 'firebase/firestore';
import { TaskService } from '../../services/task.service';
import { AuthService } from '../../services/auth.service';
import { ProjectService } from '../../services/project.service';
import { User } from '../../models/user.model';
import { Project, ProjectStatus } from '../../models/project.model';
import { Task, TaskStatus, PriorityLabel } from '../../models/task.model';

interface ColumnMapping {
  field: string;
  columnIndex: number;
  columnName: string;
}

interface ImportRow {
  rowIndex: number;
  data: any[];
  mappedData: { [key: string]: any };
  errors: string[];
  willImport: boolean;
}

interface ImportResult {
  success: number;
  skipped: number;
  errors: number;
  details: string[];
}

@Component({
  selector: 'app-task-import',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './task-import.component.html',
  styleUrl: './task-import.component.css'
})
export class TaskImportComponent implements OnInit {
  private router = inject(Router);
  private taskService = inject(TaskService);
  private authService = inject(AuthService);
  private projectService = inject(ProjectService);
  private fb = inject(FormBuilder);

  // ファイル関連
  selectedFile: File | null = null;
  fileType: 'excel' | 'csv' | null = null;
  
  // データ関連
  rawData: any[][] = [];
  headers: string[] = [];
  mappingForm: FormGroup;
  importRows: ImportRow[] = [];
  
  // マッピングフィールド
  availableFields = [
    { key: 'title', label: 'タイトル', required: true },
    { key: 'description', label: '説明', required: false },
    { key: 'memo', label: 'メモ', required: false },
    { key: 'startDate', label: '開始日', required: true },
    { key: 'endDate', label: '終了日', required: true },
    { key: 'startTime', label: '開始時間', required: false },
    { key: 'endTime', label: '終了時間', required: false },
    { key: 'status', label: 'ステータス', required: false },
    { key: 'priority', label: '優先度', required: false },
    { key: 'assigneeId', label: '担当者ID', required: false },
    { key: 'assigneeName', label: '担当者名', required: false },
    { key: 'projectId', label: 'プロジェクトID', required: false },
    { key: 'projectName', label: 'プロジェクト名', required: false }
  ];
  
  // ステップ管理
  currentStep: 'upload' | 'mapping' | 'preview' | 'result' = 'upload';
  
  // プレビュー用
  previewRows: ImportRow[] = [];
  showManualEdit = false;
  editingRowIndex: number | null = null;
  editForm: FormGroup;
  
  // インポート結果
  importResult: ImportResult | null = null;
  
  // ユーザー・プロジェクトリスト
  users: User[] = [];
  projects: Project[] = [];

  // サンプル表示関連
  showSample = false;

  // サンプルデータ
  sampleData: { [key: string]: string }[] = [
    {
      タイトル: 'サンプルタスク1',
      説明: 'これはサンプルタスクの説明です',
      メモ: 'メモ欄のサンプル',
      開始日: '2024/01/15',
      開始時間: '09:00',
      終了日: '2024/01/20',
      終了時間: '18:00',
      ステータス: '未着手',
      優先度: '重要',
      担当者名: '山田太郎',
      プロジェクト名: 'プロジェクトA'
    },
    {
      タイトル: 'サンプルタスク2',
      説明: '2つ目のサンプルタスク',
      メモ: '',
      開始日: '2024/01/16',
      開始時間: '',
      終了日: '2024/01/25',
      終了時間: '',
      ステータス: '進行中',
      優先度: '普通',
      担当者名: '',
      プロジェクト名: ''
    },
    {
      タイトル: 'サンプルタスク3',
      説明: '',
      メモ: '',
      開始日: '2024/01/17',
      開始時間: '10:00',
      終了日: '2024/01/30',
      終了時間: '17:00',
      ステータス: '未着手',
      優先度: '低め',
      担当者名: '佐藤花子',
      プロジェクト名: 'プロジェクトB'
    }
  ];

  sampleHeaders: string[] = [];

  constructor() {
    this.mappingForm = this.fb.group({});
    this.editForm = this.fb.group({
      title: [''],
      description: [''],
      memo: [''],
      startDate: [''],
      startTime: [''],
      endDate: [''],
      endTime: [''],
      status: ['not_started'],
      priority: ['normal'],
      assigneeId: [''],
      projectId: ['']
    });
  }

  get mappingFormValid(): boolean {
    // 必須項目がマッピングされているかチェック
    const requiredFields = this.availableFields.filter(f => f.required);
    return requiredFields.every(field => {
      const control = this.mappingForm.get(field.key);
      return control && control.value !== '';
    });
  }

  getImportCount(): number {
    return this.importRows.filter(r => r.willImport).length;
  }

  async ngOnInit() {
    await this.loadUsers();
    await this.loadProjects();
    // サンプルヘッダーを初期化
    if (this.sampleData.length > 0) {
      this.sampleHeaders = Object.keys(this.sampleData[0]);
    }
  }

  async loadUsers() {
    try {
      this.users = await this.authService.getAllUsers();
    } catch (error: any) {
      console.error('Error loading users:', error);
    }
  }

  async loadProjects() {
    try {
      const user = this.authService.currentUser;
      if (user) {
        this.projects = await this.projectService.getProjectsForUser(user.uid);
      }
    } catch (error: any) {
      console.error('Error loading projects:', error);
    }
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    this.selectedFile = file;
    const fileName = file.name.toLowerCase();
    
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      this.fileType = 'excel';
      this.readExcelFile(file);
    } else if (fileName.endsWith('.csv')) {
      this.fileType = 'csv';
      this.readCsvFile(file);
    } else {
      alert('サポートされていないファイル形式です。Excel (.xlsx, .xls) または CSV (.csv) を選択してください。');
      this.selectedFile = null;
    }
  }

  readExcelFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];
        
        this.processFileData(jsonData);
      } catch (error: any) {
        console.error('Error reading Excel file:', error);
        alert('Excelファイルの読み込みに失敗しました: ' + error.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  readCsvFile(file: File) {
    Papa.parse(file, {
      complete: (results: Papa.ParseResult<any>) => {
        try {
          const data = results.data as any[][];
          this.processFileData(data);
        } catch (error: any) {
          console.error('Error reading CSV file:', error);
          alert('CSVファイルの読み込みに失敗しました: ' + error.message);
        }
      },
      error: (error: any) => {
        console.error('Error parsing CSV:', error);
        alert('CSVファイルの解析に失敗しました: ' + error.message);
      }
    });
  }

  processFileData(data: any[][]) {
    if (!data || data.length === 0) {
      alert('ファイルにデータがありません。');
      return;
    }

    // ヘッダー行を取得（最初の行）
    this.headers = data[0].map((h: any) => String(h || '').trim());
    
    // データ行を取得（2行目以降）
    this.rawData = data.slice(1).filter(row => row.some(cell => cell !== '' && cell !== null && cell !== undefined));
    
    if (this.rawData.length === 0) {
      alert('データ行がありません。');
      return;
    }

    // 自動マッピングを実行
    this.autoMapColumns();
    
    // マッピングステップに進む
    this.currentStep = 'mapping';
  }

  autoMapColumns() {
    const mappings: { [key: string]: ColumnMapping } = {};
    
    // 各フィールドに対して自動マッピング
    this.availableFields.forEach(field => {
      const mapping = this.findBestMatch(field.key, this.headers);
      if (mapping) {
        mappings[field.key] = mapping;
      }
    });

    // フォームにマッピングを設定
    this.availableFields.forEach(field => {
      const mapping = mappings[field.key];
      this.mappingForm.addControl(
        field.key,
        this.fb.control(mapping ? mapping.columnIndex.toString() : '')
      );
    });
  }

  findBestMatch(fieldKey: string, headers: string[]): ColumnMapping | null {
    const keywords: { [key: string]: string[] } = {
      'title': ['タイトル', 'title', '名称', '名前', 'タスク名', '件名'],
      'description': ['説明', 'description', '詳細', '内容', '概要'],
      'memo': ['メモ', 'memo', '備考', '備忘'],
      'startDate': ['開始日', 'startdate', 'start_date', '開始', '開始年月日'],
      'endDate': ['終了日', 'enddate', 'end_date', '期限', '締切', 'due', '終了年月日'],
      'startTime': ['開始時間', 'starttime', 'start_time', '開始時刻'],
      'endTime': ['終了時間', 'endtime', 'end_time', '終了時刻'],
      'status': ['ステータス', 'status', '状態', '状況'],
      'priority': ['優先度', 'priority', '優先', '重要度'],
      'assigneeId': ['担当者id', 'assigneeid', 'assignee_id', '担当者ID'],
      'assigneeName': ['担当者', '担当者名', 'assigneename', 'assignee_name', '担当', 'アサイン'],
      'projectId': ['プロジェクトid', 'projectid', 'project_id', 'プロジェクトID'],
      'projectName': ['プロジェクト', 'プロジェクト名', 'projectname', 'project_name']
    };

    const fieldKeywords = keywords[fieldKey] || [];
    
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i].toLowerCase();
      for (const keyword of fieldKeywords) {
        if (header.includes(keyword.toLowerCase())) {
          return {
            field: fieldKey,
            columnIndex: i,
            columnName: headers[i]
          };
        }
      }
    }

    return null;
  }

  onMappingChange() {
    // マッピング変更時にプレビューを更新
    this.generatePreview();
  }

  generatePreview() {
    const mappings: ColumnMapping[] = [];
    
    this.availableFields.forEach(field => {
      const control = this.mappingForm.get(field.key);
      if (control && control.value) {
        const columnIndex = parseInt(control.value);
        if (!isNaN(columnIndex) && columnIndex < this.headers.length) {
          mappings.push({
            field: field.key,
            columnIndex: columnIndex,
            columnName: this.headers[columnIndex]
          });
        }
      }
    });

    this.importRows = this.rawData.map((row, rowIndex) => {
      const mappedData: { [key: string]: any } = {};
      const errors: string[] = [];

      mappings.forEach(mapping => {
        const value = row[mapping.columnIndex];
        const stringValue = value !== undefined && value !== null ? String(value) : '';
        mappedData[mapping.field] = this.normalizeEmptyValue(stringValue);
      });

      // バリデーション
      const requiredFields = this.availableFields.filter(f => f.required);
      requiredFields.forEach(field => {
        if (!mappedData[field.key] || mappedData[field.key] === '') {
          errors.push(`${field.label}は必須です`);
        }
      });

      // 日付のバリデーション
      if (mappedData['startDate']) {
        const startDate = this.parseDate(mappedData['startDate']);
        if (!startDate) {
          errors.push('開始日の形式が不正です');
        }
      }

      if (mappedData['endDate']) {
        const endDate = this.parseDate(mappedData['endDate']);
        if (!endDate) {
          errors.push('終了日の形式が不正です');
        }
      }

      // 開始日と終了日の比較
      if (mappedData['startDate'] && mappedData['endDate']) {
        const startDate = this.parseDate(mappedData['startDate']);
        const endDate = this.parseDate(mappedData['endDate']);
        if (startDate && endDate && startDate > endDate) {
          errors.push('開始日が終了日より後です');
        }
      }

      // 担当者名の存在チェック（正規化後なので既に空欄の場合はスキップ）
      if (mappedData['assigneeName'] && mappedData['assigneeName'] !== '') {
        const assigneeNameValue = mappedData['assigneeName'];
        const user = this.users.find(u => 
          u.displayName === assigneeNameValue || 
          u.email === assigneeNameValue
        );
        if (!user) {
          errors.push(`担当者「${assigneeNameValue}」は存在しません`);
          // 担当者名をクリア（担当者未設定にする）
          mappedData['assigneeName'] = '';
          mappedData['assigneeId'] = '';
        }
      }

      return {
        rowIndex: rowIndex + 2, // ヘッダー行を考慮して+2
        data: row,
        mappedData: mappedData,
        errors: errors,
        willImport: errors.length === 0
      };
    });

    // すべての行をプレビューに表示（エラーがある行は最初に表示）
    this.previewRows = [...this.importRows].sort((a, b) => {
      if (a.errors.length > 0 && b.errors.length === 0) return -1;
      if (a.errors.length === 0 && b.errors.length > 0) return 1;
      return a.rowIndex - b.rowIndex;
    });
  }

  parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    
    // Excelのシリアル日付値（数値）をチェック
    // Excelのシリアル日付は1900年1月1日を1とする数値
    const numericValue = Number(dateStr);
    if (!isNaN(numericValue) && numericValue > 0 && numericValue < 1000000 && !dateStr.includes('/') && !dateStr.includes('-') && !dateStr.includes('年')) {
      // Excelのシリアル日付を変換
      // Excelの基準日 (1900/1/1) はJavaScriptの1899/12/30に相当するため、2日引く
      // シリアル値1 = 1900/1/1 = Date(1899, 11, 30) + 1日
      const excelEpoch = new Date(1899, 11, 30); // 1899年12月30日（月は0始まり）
      const days = Math.floor(numericValue);
      const date = new Date(excelEpoch.getTime() + (days - 1) * 24 * 60 * 60 * 1000);
      return date;
    }
    
    // 様々な日付形式に対応
    const patterns = [
      /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
      /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/,
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
      /^(\d{4})年(\d{1,2})月(\d{1,2})日$/  // YYYY年MM月DD日形式
    ];

    for (const pattern of patterns) {
      const match = dateStr.match(pattern);
      if (match) {
        let year, month, day;
        if (match[1].length === 4) {
          // YYYY/MM/DD形式 または YYYY年MM月DD日形式
          year = parseInt(match[1]);
          month = parseInt(match[2]) - 1;
          day = parseInt(match[3]);
        } else {
          // MM/DD/YYYY形式
          year = parseInt(match[3]);
          month = parseInt(match[1]) - 1;
          day = parseInt(match[2]);
        }
        const date = new Date(year, month, day);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }

    // Date.parseを試す
    const parsed = Date.parse(dateStr);
    if (!isNaN(parsed)) {
      return new Date(parsed);
    }

    return null;
  }

  // 未入力として扱う値を空欄に変換
  normalizeEmptyValue(value: string): string {
    if (!value) return '';
    const trimmed = String(value).trim();
    // 「-」「ー」「None」「none」「null」「NULL」などを空欄として扱う
    if (trimmed === '-' || trimmed === 'ー' || trimmed.toLowerCase() === 'none' || 
        trimmed.toLowerCase() === 'null' || trimmed === '') {
      return '';
    }
    return trimmed;
  }

  parseTime(timeStr: string): { hours: number; minutes: number } | null {
    if (!timeStr) return null;
    
    const patterns = [
      /^(\d{1,2}):(\d{2})$/,
      /^(\d{1,2}):(\d{2}):(\d{2})$/
    ];

    for (const pattern of patterns) {
      const match = timeStr.match(pattern);
      if (match) {
        const hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
          return { hours, minutes };
        }
      }
    }

    return null;
  }

  goToPreview() {
    // プレビューを生成
    this.generatePreview();
    
    // 必須項目が空欄の行を検出
    const requiredFields = this.availableFields.filter(f => f.required);
    const rowsWithMissingRequiredFields = this.importRows.filter(row => {
      return requiredFields.some(field => {
        const value = row.mappedData[field.key];
        return !value || value === '';
      });
    });
    
    // 必須項目が空欄の行がある場合、確認ダイアログを表示
    if (rowsWithMissingRequiredFields.length > 0) {
      const rowNumbers = rowsWithMissingRequiredFields.map(r => r.rowIndex).join(', ');
      const message = `必須項目（タイトル、開始日、終了日）が空欄の行があります。\n行番号: ${rowNumbers}\n\n手動修正を推奨します。手動修正しますか？\n（「キャンセル」を選択すると、エラー行はスキップされます）`;
      
      if (confirm(message)) {
        // 手動修正を選択した場合、プレビューに進み、最初のエラー行を編集モードにする
        this.currentStep = 'preview';
        if (rowsWithMissingRequiredFields.length > 0) {
          // 最初のエラー行のプレビューインデックスを取得
          const firstErrorRow = rowsWithMissingRequiredFields[0];
          const previewIndex = this.previewRows.findIndex(r => r.rowIndex === firstErrorRow.rowIndex);
          if (previewIndex !== -1) {
            // 少し遅延を入れて編集モードを開く（DOM更新を待つため）
            setTimeout(() => {
              this.editRow(previewIndex);
            }, 100);
          }
        }
      } else {
        // キャンセルを選択した場合、プレビューに進む（エラー行はスキップされる）
        this.currentStep = 'preview';
      }
    } else {
      // エラーがない場合は通常通りプレビューに進む
      this.currentStep = 'preview';
    }
  }

  editRow(previewIndex: number) {
    // previewRowsのインデックスから、実際のimportRowsの行を見つける
    const previewRow = this.previewRows[previewIndex];
    if (!previewRow) return;

    // importRowsから対応する行を見つける（rowIndexでマッチング）
    const actualIndex = this.importRows.findIndex(r => r.rowIndex === previewRow.rowIndex);
    if (actualIndex === -1) return;

    const row = this.importRows[actualIndex];
    this.editingRowIndex = actualIndex; // importRowsの実際のインデックスを保存
    
    // 優先度の変換（日本語から英語に変換）
    let priorityValue = 'normal'; // デフォルト値
    if (row.mappedData['priority']) {
      const priorityStr = String(row.mappedData['priority']).toLowerCase();
      if (priorityStr.includes('重要') || priorityStr.includes('important')) {
        priorityValue = 'important';
      } else if (priorityStr.includes('低') || priorityStr.includes('low')) {
        priorityValue = 'low';
      } else if (priorityStr.includes('なし') || priorityStr.includes('none')) {
        priorityValue = 'none';
      } else if (priorityStr.includes('普通') || priorityStr.includes('normal')) {
        priorityValue = 'normal';
      } else {
        // 既に英語の値の場合はそのまま使用
        priorityValue = row.mappedData['priority'];
      }
    }
    
    // ステータスの変換（日本語から英語に変換）
    let statusValue = 'not_started'; // デフォルト値
    if (row.mappedData['status']) {
      const statusStr = String(row.mappedData['status']).toLowerCase();
      if (statusStr.includes('進行中') || statusStr.includes('in_progress')) {
        statusValue = 'in_progress';
      } else if (statusStr.includes('完了') || statusStr.includes('completed')) {
        statusValue = 'completed';
      } else if (statusStr.includes('未着手') || statusStr.includes('not_started')) {
        statusValue = 'not_started';
      } else {
        // 既に英語の値の場合はそのまま使用
        statusValue = row.mappedData['status'];
      }
    }
    
    this.editForm.patchValue({
      title: row.mappedData['title'] || '',
      description: row.mappedData['description'] || '',
      memo: row.mappedData['memo'] || '',
      startDate: this.formatDateForInput(row.mappedData['startDate']),
      startTime: row.mappedData['startTime'] || '',
      endDate: this.formatDateForInput(row.mappedData['endDate']),
      endTime: row.mappedData['endTime'] || '',
      status: statusValue,
      priority: priorityValue,
      assigneeId: row.mappedData['assigneeId'] || '',
      projectId: row.mappedData['projectId'] || ''
    });
  }

  saveRowEdit() {
    if (this.editingRowIndex === null) return;

    const formValue = this.editForm.value;
    const row = this.importRows[this.editingRowIndex];
    
    // マッピングデータを更新（未入力値の正規化を適用）
    Object.keys(formValue).forEach(key => {
      const value = formValue[key];
      // 文字列の場合は正規化を適用
      if (typeof value === 'string') {
        row.mappedData[key] = this.normalizeEmptyValue(value);
      } else {
        row.mappedData[key] = value;
      }
    });

    // エラーチェックを再実行
    row.errors = [];
    
    // 必須項目のチェック
    const requiredFields = this.availableFields.filter(f => f.required);
    requiredFields.forEach(field => {
      if (!row.mappedData[field.key] || row.mappedData[field.key] === '') {
        row.errors.push(`${field.label}は必須です`);
      }
    });

    // 日付のバリデーション
    if (row.mappedData['startDate']) {
      const startDate = this.parseDate(row.mappedData['startDate']);
      if (!startDate) {
        row.errors.push('開始日の形式が不正です');
      }
    }

    if (row.mappedData['endDate']) {
      const endDate = this.parseDate(row.mappedData['endDate']);
      if (!endDate) {
        row.errors.push('終了日の形式が不正です');
      }
    }

    // 開始日と終了日の比較
    if (row.mappedData['startDate'] && row.mappedData['endDate']) {
      const startDate = this.parseDate(row.mappedData['startDate']);
      const endDate = this.parseDate(row.mappedData['endDate']);
      if (startDate && endDate && startDate > endDate) {
        row.errors.push('開始日が終了日より後です');
      }
    }

    row.willImport = row.errors.length === 0;
    this.editingRowIndex = null;
    
    // プレビューを再生成（既存のimportRowsを保持）
    this.previewRows = [...this.importRows].sort((a, b) => {
      if (a.errors.length > 0 && b.errors.length === 0) return -1;
      if (a.errors.length === 0 && b.errors.length > 0) return 1;
      return a.rowIndex - b.rowIndex;
    });
  }

  cancelRowEdit() {
    this.editingRowIndex = null;
  }

  formatDateForInput(dateStr: string): string {
    const date = this.parseDate(dateStr);
    if (!date) return '';
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  formatDateForDisplay(dateStr: string): string {
    if (!dateStr) return '-';
    const date = this.parseDate(dateStr);
    if (!date) return dateStr; // パースできない場合は元の文字列を返す
    
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}年${month}月${day}日`;
  }

  formatStatusForDisplay(status: string): string {
    if (!status) return '未着手';
    const statusStr = String(status).toLowerCase();
    if (statusStr.includes('進行中') || statusStr.includes('in_progress')) {
      return '進行中';
    } else if (statusStr.includes('完了') || statusStr.includes('completed')) {
      return '完了';
    } else if (statusStr.includes('未着手') || statusStr.includes('not_started')) {
      return '未着手';
    }
    return status; // 変換できない場合は元の値を返す
  }

  formatPriorityForDisplay(priority: string): string {
    if (!priority) return '普通';
    const priorityStr = String(priority).toLowerCase();
    if (priorityStr.includes('重要') || priorityStr.includes('important')) {
      return '重要';
    } else if (priorityStr.includes('低') || priorityStr.includes('low')) {
      return '低め';
    } else if (priorityStr.includes('なし') || priorityStr.includes('none')) {
      return 'なし';
    } else if (priorityStr.includes('普通') || priorityStr.includes('normal')) {
      return '普通';
    }
    return priority; // 変換できない場合は元の値を返す
  }

  toggleRowImport(rowIndex: number) {
    const row = this.importRows[rowIndex];
    if (row) {
      row.willImport = !row.willImport;
    }
  }

  async executeImport() {
    const user = this.authService.currentUser;
    if (!user) {
      alert('ユーザーがログインしていません');
      return;
    }

    const rowsToImport = this.importRows.filter(row => row.willImport);
    if (rowsToImport.length === 0) {
      alert('インポートする行がありません');
      return;
    }

    const result: ImportResult = {
      success: 0,
      skipped: 0,
      errors: 0,
      details: []
    };

    for (const row of rowsToImport) {
      try {
        // マッピングデータからタスクを作成
        const taskData = await this.createTaskFromRow(row, user.uid);
        
        if (taskData) {
          await this.taskService.createTask(taskData);
          result.success++;
          result.details.push(`行${row.rowIndex}: インポート成功 - ${row.mappedData['title']}`);
        } else {
          result.skipped++;
          result.details.push(`行${row.rowIndex}: スキップ - ${row.mappedData['title']}`);
        }
      } catch (error: any) {
        result.errors++;
        result.details.push(`行${row.rowIndex}: エラー - ${error.message}`);
        console.error(`Error importing row ${row.rowIndex}:`, error);
      }
    }

    this.importResult = result;
    this.currentStep = 'result';
  }

  async createTaskFromRow(row: ImportRow, creatorId: string): Promise<Partial<Task> | null> {
    const mapped = row.mappedData;

    // 必須項目のチェック
    if (!mapped['title'] || !mapped['startDate'] || !mapped['endDate']) {
      return null;
    }

    // 日付のパース
    const startDate = this.parseDate(mapped['startDate']);
    const endDate = this.parseDate(mapped['endDate']);
    
    if (!startDate || !endDate) {
      return null;
    }

    // 時間の設定
    if (mapped['startTime']) {
      const startTime = this.parseTime(mapped['startTime']);
      if (startTime) {
        startDate.setHours(startTime.hours, startTime.minutes, 0, 0);
      } else {
        startDate.setHours(0, 0, 0, 0);
      }
    } else {
      startDate.setHours(0, 0, 0, 0);
    }

    if (mapped['endTime']) {
      const endTime = this.parseTime(mapped['endTime']);
      if (endTime) {
        endDate.setHours(endTime.hours, endTime.minutes, 0, 0);
      } else {
        endDate.setHours(23, 59, 59, 999);
      }
    } else {
      endDate.setHours(23, 59, 59, 999);
    }

    // ステータスの変換
    let status = TaskStatus.NotStarted;
    if (mapped['status']) {
      const statusStr = String(mapped['status']).toLowerCase();
      if (statusStr.includes('進行中') || statusStr.includes('in_progress')) {
        status = TaskStatus.InProgress;
      } else if (statusStr.includes('完了') || statusStr.includes('completed')) {
        status = TaskStatus.Completed;
      }
    }

    // 優先度の変換
    let priority = PriorityLabel.Normal;
    if (mapped['priority']) {
      const priorityStr = String(mapped['priority']).toLowerCase();
      if (priorityStr.includes('重要') || priorityStr.includes('important')) {
        priority = PriorityLabel.Important;
      } else if (priorityStr.includes('低') || priorityStr.includes('low')) {
        priority = PriorityLabel.Low;
      } else if (priorityStr.includes('なし') || priorityStr.includes('none')) {
        priority = PriorityLabel.None;
      }
    }

    // 担当者の処理
    let assigneeId: string | undefined = undefined;
    let assigneeName: string | undefined = undefined;
    
    if (mapped['assigneeId']) {
      assigneeId = mapped['assigneeId'];
      const user = this.users.find(u => u.id === assigneeId);
      assigneeName = user?.displayName || user?.email || 'Unknown';
    } else if (mapped['assigneeName'] && mapped['assigneeName'].trim() !== '') {
      const assigneeNameValue = mapped['assigneeName'].trim();
      const user = this.users.find(u => 
        u.displayName === assigneeNameValue || 
        u.email === assigneeNameValue
      );
      if (user) {
        assigneeId = user.id;
        assigneeName = user.displayName || user.email || 'Unknown';
      } else {
        // ユーザーが存在しない場合は担当者未設定（作成者も設定しない）
        assigneeId = undefined;
        assigneeName = undefined;
      }
    } else {
      // 担当者名が指定されていない場合、担当者未設定
      assigneeId = undefined;
      assigneeName = undefined;
    }

    // プロジェクトの処理
    let projectId: string | undefined = undefined;
    let projectName: string | undefined = undefined;
    
    if (mapped['projectId']) {
      projectId = mapped['projectId'];
      const project = this.projects.find(p => p.id === projectId);
      projectName = project?.name;
    } else if (mapped['projectName']) {
      const projectNameValue = this.normalizeEmptyValue(mapped['projectName']);
      if (projectNameValue) {
        let project = this.projects.find(p => p.name === projectNameValue);
        
        // プロジェクトが存在しない場合は自動作成
        if (!project) {
          try {
            const newProjectId = await this.projectService.createProject({
              name: projectNameValue,
              description: `インポート時に自動作成されたプロジェクト: ${projectNameValue}`,
              startDate: Timestamp.fromDate(startDate),
              endDate: Timestamp.fromDate(endDate)
            });
            
            // 作成したプロジェクトをリストに追加（重複作成を防ぐため）
            project = {
              id: newProjectId,
              name: projectNameValue,
              description: `インポート時に自動作成されたプロジェクト: ${projectNameValue}`,
              ownerId: creatorId,
              ownerName: this.users.find(u => u.id === creatorId)?.displayName || 'Unknown',
              members: [],
              status: ProjectStatus.NotStarted, // デフォルトは準備中
              startDate: Timestamp.fromDate(startDate),
              endDate: Timestamp.fromDate(endDate),
              completionRate: 0,
              totalTasks: 0,
              completedTasks: 0,
              isDeleted: false,
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now()
            } as Project;
            
            this.projects.push(project);
          } catch (error: any) {
            console.error(`Error creating project "${projectNameValue}":`, error);
            // エラーが発生してもタスクの作成は続行（プロジェクトなしで）
          }
        }
        
        if (project) {
          projectId = project.id;
          projectName = project.name;
        }
      }
    }

    return {
      title: mapped['title'],
      description: mapped['description'] || '',
      memo: mapped['memo'] || '',
      startDate: Timestamp.fromDate(startDate),
      endDate: Timestamp.fromDate(endDate),
      status: status,
      priority: priority,
      assigneeId: assigneeId,
      assigneeName: assigneeName,
      projectId: projectId,
      projectName: projectName
    };
  }

  reset() {
    this.selectedFile = null;
    this.fileType = null;
    this.rawData = [];
    this.headers = [];
    this.importRows = [];
    this.previewRows = [];
    this.importResult = null;
    this.currentStep = 'upload';
    this.mappingForm = this.fb.group({});
  }

  goBack() {
    this.router.navigate(['/home']);
  }

  toggleSample() {
    this.showSample = !this.showSample;
  }
}

