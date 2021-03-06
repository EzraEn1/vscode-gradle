import * as vscode from 'vscode';
import * as path from 'path';
import {
  GradleTaskTreeItem,
  RootProjectTreeItem,
  ProjectTreeItem,
  GroupTreeItem,
  NoGradleTasksTreeItem,
  TreeItemWithTasksOrGroups,
} from '..';

import { GradleTaskDefinition } from '../../tasks';
import { isWorkspaceFolder } from '../../util';
import { Extension } from '../../extension';
import { isGradleTask } from '../../tasks/taskUtil';
import { RootProjectsStore } from '../../stores';

const gradleTaskTreeItemMap: Map<string, GradleTaskTreeItem> = new Map();
const gradleProjectTreeItemMap: Map<string, RootProjectTreeItem> = new Map();
const projectTreeItemMap: Map<string, ProjectTreeItem> = new Map();
const groupTreeItemMap: Map<string, GroupTreeItem> = new Map();

export function getGradleTaskTreeItemMap(): Map<string, GradleTaskTreeItem> {
  return gradleTaskTreeItemMap;
}

export function getProjectTreeItemMap(): Map<string, ProjectTreeItem> {
  return projectTreeItemMap;
}

function resetCachedTreeItems(): void {
  gradleTaskTreeItemMap.clear();
  gradleProjectTreeItemMap.clear();
  projectTreeItemMap.clear();
  groupTreeItemMap.clear();
}

export class GradleTasksTreeDataProvider
  implements vscode.TreeDataProvider<vscode.TreeItem> {
  private collapsed = true;

  private readonly _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | null> = new vscode.EventEmitter<vscode.TreeItem | null>();
  public readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | null> = this
    ._onDidChangeTreeData.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly rootProjectStore: RootProjectsStore
  ) {
    const collapsed = this.context.workspaceState.get(
      'gradleTasksCollapsed',
      false
    );
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.setCollapsed(collapsed);
  }

  public async setCollapsed(collapsed: boolean): Promise<void> {
    this.collapsed = collapsed;
    await this.context.workspaceState.update('gradleTasksCollapsed', collapsed);
    await vscode.commands.executeCommand(
      'setContext',
      'gradle:gradleTasksCollapsed',
      collapsed
    );
    this.refresh();
  }

  private async buildTreeItems(): Promise<vscode.TreeItem[]> {
    resetCachedTreeItems();
    // using vscode.tasks.fetchTasks({ type: 'gradle' }) is *incredibly slow* which
    // is why we get them directly from the task provider
    const tasks = await Extension.getInstance()
      .getGradleTaskProvider()
      .loadTasks();
    return tasks.length === 0
      ? [new NoGradleTasksTreeItem(this.context)]
      : this.buildItemsTreeFromTasks(tasks);
  }

  public refresh(treeItem: vscode.TreeItem | null = null): void {
    this._onDidChangeTreeData.fire(treeItem);
  }

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public getParent(element: vscode.TreeItem): vscode.TreeItem | null {
    if (
      element instanceof RootProjectTreeItem ||
      element instanceof ProjectTreeItem ||
      element instanceof TreeItemWithTasksOrGroups ||
      element instanceof GradleTaskTreeItem
    ) {
      return element.parentTreeItem || null;
    }
    return null;
  }

  public async getChildren(
    element?: vscode.TreeItem
  ): Promise<vscode.TreeItem[]> {
    if (element instanceof RootProjectTreeItem) {
      return element.projects;
    }
    if (element instanceof ProjectTreeItem) {
      return [...element.groups, ...element.tasks];
    }
    if (element instanceof GroupTreeItem) {
      return element.tasks;
    }
    if (
      element instanceof GradleTaskTreeItem ||
      element instanceof NoGradleTasksTreeItem
    ) {
      return [];
    }
    if (!element) {
      return await this.buildTreeItems();
    }
    return [];
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  public buildItemsTreeFromTasks(
    tasks: vscode.Task[]
  ): RootProjectTreeItem[] | NoGradleTasksTreeItem[] {
    let gradleProjectTreeItem = null;

    tasks.forEach((task) => {
      const definition = task.definition as GradleTaskDefinition;
      if (isWorkspaceFolder(task.scope) && isGradleTask(task)) {
        const rootProject = this.rootProjectStore.get(definition.projectFolder);
        if (!rootProject) {
          return;
        }
        gradleProjectTreeItem = gradleProjectTreeItemMap.get(
          definition.projectFolder
        );
        if (!gradleProjectTreeItem) {
          gradleProjectTreeItem = new RootProjectTreeItem(
            path.basename(definition.projectFolder),
            rootProject.getProjectUri()
          );
          gradleProjectTreeItemMap.set(
            definition.projectFolder,
            gradleProjectTreeItem
          );
        }

        let projectTreeItem = projectTreeItemMap.get(definition.buildFile);
        if (!projectTreeItem) {
          projectTreeItem = new ProjectTreeItem(
            definition.project,
            gradleProjectTreeItem,
            vscode.Uri.file(definition.buildFile)
          );
          gradleProjectTreeItem.addProject(projectTreeItem);
          projectTreeItemMap.set(definition.buildFile, projectTreeItem);
        }

        const taskName = definition.script.slice(
          definition.script.lastIndexOf(':') + 1
        );
        let parentTreeItem: ProjectTreeItem | GroupTreeItem = projectTreeItem;

        if (!this.collapsed) {
          const groupId = definition.group + definition.project;
          let groupTreeItem = groupTreeItemMap.get(groupId);
          if (!groupTreeItem) {
            groupTreeItem = new GroupTreeItem(
              definition.group,
              projectTreeItem,
              undefined
            );
            projectTreeItem.addGroup(groupTreeItem);
            groupTreeItemMap.set(groupId, groupTreeItem);
          }
          parentTreeItem = groupTreeItem;
        }

        const taskTreeItem = new GradleTaskTreeItem(
          parentTreeItem,
          task,
          taskName,
          definition.description || taskName,
          '',
          rootProject.getJavaDebug()
        );
        taskTreeItem.setContext();

        gradleTaskTreeItemMap.set(task.definition.id, taskTreeItem);
        parentTreeItem.addTask(taskTreeItem);
      }
    });

    if (gradleProjectTreeItemMap.size === 1) {
      return gradleProjectTreeItemMap.values().next().value.projects;
    }
    return [...gradleProjectTreeItemMap.values()];
  }
}
