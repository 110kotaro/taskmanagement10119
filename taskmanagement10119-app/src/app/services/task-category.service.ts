import { Injectable } from '@angular/core';
import { Task } from '../models/task.model';

export interface TaskCategory {
  name: string;
  tasks: Task[];
}

@Injectable({
  providedIn: 'root'
})
export class TaskCategoryService {
  
  categorizeTasks(tasks: Task[]): TaskCategory[] {
    const categories: TaskCategory[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    //各カテゴリーのタスクを格納するset（重複防止）
    const usedTaskIds = new Set<string>();

    // 期限切れ（未完了）優先１位
    const overdueTasks = tasks.filter(task => {
      if (usedTaskIds.has(task.id)) return false;
      const endDate = task.endDate.toDate();
      const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      if(endDateOnly < today && task.status !== 'completed'){
        usedTaskIds.add(task.id);
        return true;
      }
      return false;
    });

    // 今日が期限のタスク 優先２位
    const dueTodayTasks = tasks.filter(task => {
      if (usedTaskIds.has(task.id)) return false;
      const endDate = task.endDate.toDate();
      const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      if(endDateOnly.getTime() === today.getTime() && task.status !== 'completed'){
        usedTaskIds.add(task.id);
        return true;
      }
      return false;
    });

     // 開始日が過ぎていて未着手のタスク 優先３位
     const unstartedTasks = tasks.filter(task => {
      if (usedTaskIds.has(task.id)) return false;
      const startDate = task.startDate.toDate();
      const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      if(startDateOnly < today && task.status === 'not_started'){
        usedTaskIds.add(task.id);
        return true;
      }
      return false;
    });
    
    // 今日から開始のタスク（期限は今日以降、開始日が今日） 優先４位
    // 進行中を除外し、未着手のみを表示
    const startsTodayTasks = tasks.filter(task => {
      if (usedTaskIds.has(task.id)) return false;
      const startDate = task.startDate.toDate();
      const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      const endDate = task.endDate.toDate();
      const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      if(startDateOnly.getTime() === today.getTime() && endDateOnly >= today && task.status === 'not_started'){
        usedTaskIds.add(task.id);
        return true;
      }
      return false;
    });   
    
    // 進行中のタスク（期限は今日以降、開始日は今日以前） 優先５位
    const inProgressTasks = tasks.filter(task => {
      if (usedTaskIds.has(task.id)) return false;
      const startDate = task.startDate.toDate();
      const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      const endDate = task.endDate.toDate();
      const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      if(startDateOnly <= today && endDateOnly >= today && task.status === 'in_progress'){
        usedTaskIds.add(task.id);
        return true;
      }
      return false;
    });

    // 今日完了したタスク 優先６位
    const completedTodayTasks = tasks.filter(task => {
      if (usedTaskIds.has(task.id)) return false;
      if (!task.completedAt) return false;
      const completedAt = task.completedAt.toDate();
      const completedAtOnly = new Date(completedAt.getFullYear(), completedAt.getMonth(), completedAt.getDate());
      if(completedAtOnly.getTime() === today.getTime() && task.status === 'completed'){
        usedTaskIds.add(task.id);
        return true;
      }
      return false;
    });
    

    if (overdueTasks.length > 0) {
      categories.push({ name: '期限切れ（未完了）', tasks: overdueTasks });
    }

    if (dueTodayTasks.length > 0) {
      categories.push({ name: '今日が期限', tasks: dueTodayTasks });
    }

    if (unstartedTasks.length > 0) {
      categories.push({ name: '開始日が過ぎていて未着手', tasks: unstartedTasks });
    }

    if (startsTodayTasks.length > 0) {
      categories.push({ name: '今日から開始', tasks: startsTodayTasks });
    }
    
    if (inProgressTasks.length > 0) {
      categories.push({ name: '進行中', tasks: inProgressTasks });
    }

    if (completedTodayTasks.length > 0) {
      categories.push({ name: '今日完了したタスク', tasks: completedTodayTasks });
    }
    return categories;
  }

  categorizeWeekTasks(tasks: Task[], weekViewMode: 'calendar' | 'rolling'='calendar'): TaskCategory[] {
    const categories: TaskCategory[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let weekStart: Date;
    let weekEnd: Date;
    
    if (weekViewMode === 'calendar') {
    // 今週の開始と終了
      const dayOfWeek = today.getDay(); // 0=日曜日
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; //月曜日を基準に調整
      weekStart = new Date(today);
      weekStart.setDate(today.getDate() +mondayOffset); // 月曜日に調整
      weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6); // 日曜日
    } else {
      // 今日から7日間
      weekStart = new Date(today);
      weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6); //今日から6日後（7日間）
    }

    const usedTaskIds = new Set<string>();
    
    // 期限切れ（未完了）優先１位
    const overdueTasks = tasks.filter(task => {
      if (usedTaskIds.has(task.id)) return false;
      const endDate = task.endDate.toDate();
      const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      if(endDateOnly < today && task.status !== 'completed'){
        usedTaskIds.add(task.id);
        return true;
      }
      return false;
    });

    // 今週が期限（今日から今週末まで） 優先２位
    const dueThisWeekTasks = tasks.filter(task => {
      if (usedTaskIds.has(task.id)) return false;
      const endDate = task.endDate.toDate();
      const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      if(endDateOnly >= today && endDateOnly <= weekEnd && task.status !== 'completed'){
        usedTaskIds.add(task.id);
        return true;
      }
      return false;
    });
 
    // 開始日が過ぎていて未着手 優先３位
    const unstartedTasks = tasks.filter(task => {
      if (usedTaskIds.has(task.id)) return false;
      const startDate = task.startDate.toDate();
      const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      if(startDateOnly < today && task.status === 'not_started'){
        usedTaskIds.add(task.id);
        return true;
      }
      return false;
    });    
    
    // 今週開始予定（今日から今週末までに開始日があり、未完了） 優先４位
    // 進行中を除外し、未着手のみを表示
    const startsThisWeekTasks = tasks.filter(task => {
      if (usedTaskIds.has(task.id)) return false;
      const startDate = task.startDate.toDate();
      const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      if(startDateOnly >= today && startDateOnly <= weekEnd && task.status === 'not_started'){
        usedTaskIds.add(task.id);
        return true;
      }
      return false;
    });
    
    // 進行中（期限は今週以降、開始日は今日以前） 優先５位
    const inProgressTasks = tasks.filter(task => {
      if (usedTaskIds.has(task.id)) return false;
      const startDate = task.startDate.toDate();
      const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      const endDate = task.endDate.toDate();
      const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      if(startDateOnly <= today && endDateOnly >= today && task.status === 'in_progress'){
        usedTaskIds.add(task.id);
        return true;
      }
      return false;
    });

    // 今週完了したタスク 優先６位
    const completedThisWeekTasks = tasks.filter(task => {
      if (usedTaskIds.has(task.id)) return false;
      if (!task.completedAt) return false;
      const completedAt = task.completedAt.toDate();
      const completedAtOnly = new Date(completedAt.getFullYear(), completedAt.getMonth(), completedAt.getDate());
      const weekEndDate = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate());
      if(completedAtOnly >= weekStart && completedAtOnly <= weekEndDate && task.status === 'completed'){
        usedTaskIds.add(task.id);
        return true;
      }
      return false;
    });
    
    // 表示順序に従って追加
    if (overdueTasks.length > 0) {
      categories.push({ name: '期限切れ（未完了）', tasks: overdueTasks });
    }

    if (dueThisWeekTasks.length > 0) {
      const label=weekViewMode==='calendar'?'今週が期限':'7日後までが期限';
      categories.push({ name: label, tasks: dueThisWeekTasks });
    }

    if (unstartedTasks.length > 0) {
      categories.push({ name: '開始日が過ぎていて未着手', tasks: unstartedTasks });
    }
    
    if (startsThisWeekTasks.length > 0) {
      const label=weekViewMode==='calendar'?'今週開始予定':'7日後までに開始予定';
      categories.push({ name: label, tasks: startsThisWeekTasks });
    }
    
    if (inProgressTasks.length > 0) {
      categories.push({ name: '進行中', tasks: inProgressTasks });
    }
    
    if (completedThisWeekTasks.length > 0) {
      const label=weekViewMode==='calendar'?'今週完了したタスク':'今日完了したタスク';
      categories.push({ name: label, tasks: completedThisWeekTasks });
    }
    
    return categories;
  }
}

