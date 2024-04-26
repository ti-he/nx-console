import type {
  ProjectConfiguration,
  TargetConfiguration,
} from 'nx/src/devkit-exports';
import { getNxWorkspaceProjects } from '@nx-console/vscode/nx-workspace';
import { getOutputChannel, getWorkspacePath } from '@nx-console/vscode/utils';
import { join } from 'node:path';
import { TreeItemCollapsibleState } from 'vscode';

declare module 'nx/src/devkit-exports' {
  interface TargetConfiguration {
    // Nx targets can have arbitrary additional properties.
    // This allows users to assign a group to a target.
    group?: string;
  }
}

export interface ProjectViewStrategy<T> {
  getChildren(element?: T): Promise<T[] | undefined>;
}

interface BaseViewItem<Context extends string> {
  id: string;
  contextValue: Context;
  label: string;
  collapsible: TreeItemCollapsibleState;
}

export interface FolderViewItem extends BaseViewItem<'folder'> {
  path: string;
  resource: string;
}

export interface ProjectViewItem extends BaseViewItem<'project'> {
  nxProject: NxProject;
  resource: string;
}

export interface TargetViewItem extends BaseViewItem<'target'> {
  nxProject: NxProject;
  nxTarget: NxTarget;
  group?: string;
}

export interface TargetViewItemGroup extends BaseViewItem<'group'> {
  nxProject: NxProject;
  targetViewItems: TargetViewItem[];
}

export type TargetViewTreeItem = TargetViewItem | TargetViewItemGroup;

export interface NxProject {
  project: string;
  root: string;
}

export interface NxTarget {
  name: string;
  configuration?: string;
}

export abstract class BaseView {
  createProjectViewItem(
    [projectName, { root, name, targets }]: [
      projectName: string,
      projectDefinition: ProjectConfiguration
    ],
    collapsible = TreeItemCollapsibleState.Collapsed
  ): ProjectViewItem {
    const hasChildren =
      !targets ||
      Object.keys(targets).length !== 0 ||
      Object.getPrototypeOf(targets) !== Object.prototype;

    const nxProject = { project: name ?? projectName, root };

    if (root === undefined) {
      getOutputChannel().appendLine(
        `Project ${nxProject.project} has no root. This could be because of an error loading the workspace configuration.`
      );
    }

    return {
      id: projectName,
      contextValue: 'project',
      nxProject,
      label: projectName,
      resource: join(getWorkspacePath(), nxProject.root ?? ''),
      collapsible: hasChildren ? collapsible : TreeItemCollapsibleState.None,
    };
  }

  async createTargetsFromProject(parent: ProjectViewItem) {
    const { nxProject } = parent;

    const projectDef = (await getNxWorkspaceProjects())[nxProject.project];
    if (!projectDef) {
      return;
    }

    const { targets } = projectDef;
    if (!targets) {
      return;
    }

    const targetViewItems = Object.entries(targets).map((target) =>
      this.createTargetTreeItem(nxProject, target)
    );
    const treeItems = this.groupTargets(nxProject, targetViewItems);
    // sort alphabetically
    // groups come before ungrouped targets
    treeItems.sort((a, b) => {
      if (a.contextValue === 'group' && b.contextValue !== 'group') {
        return -1;
      }
      if (a.contextValue !== 'group' && b.contextValue === 'group') {
        return 1;
      }
      return a.label.localeCompare(b.label);
    });
    // also sort each group
    treeItems.forEach((item) => {
      if (item.contextValue === 'group') {
        item.targetViewItems.sort((a, b) => a.label.localeCompare(b.label));
      }
    });

    return treeItems;
  }

  async createTargetsFromGroup(parent: TargetViewItemGroup) {
    return parent.targetViewItems;
  }

  private groupTargets(
    nxProject: NxProject,
    targets: TargetViewItem[]
  ): TargetViewTreeItem[] {
    const result: TargetViewTreeItem[] = [];
    const groupNames = Array.from(
      new Set(
        targets
          .map((target) => target.group?.toLowerCase())
          .filter((group): group is string => Boolean(group))
      )
    );

    for (const groupName of groupNames) {
      const groupTargets = targets.filter(
        (target) => target.group?.toLowerCase() === groupName
      );

      const group: TargetViewItemGroup = {
        collapsible: TreeItemCollapsibleState.Collapsed,
        contextValue: 'group',
        id: `${nxProject.project}:group:${groupName}`,
        label: groupName,
        nxProject: nxProject,
        targetViewItems: groupTargets,
      };

      result.push(group);
    }

    // Add any targets that don't have a group
    const ungroupedTargets = targets.filter((target) => !target.group);
    result.push(...ungroupedTargets);

    return result;
  }

  createTargetTreeItem(
    nxProject: NxProject,
    [targetName, configuration]: [
      targetName: string,
      targetDefinition: TargetConfiguration
    ]
  ): TargetViewItem {
    const myConfiguration = configuration;
    const cofigs = myConfiguration.configurations;
    const hasConfigs = cofigs && Object.keys(cofigs).length > 0;
    return {
      id: `${nxProject.project}:${targetName}`,
      contextValue: 'target',
      nxProject,
      nxTarget: { name: targetName },
      group: myConfiguration.group,
      label: targetName,
      collapsible: hasConfigs
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.None,
    };
  }

  async createConfigurationsFromTarget(
    parent: TargetViewItem
  ): Promise<TargetViewItem[] | undefined> {
    const { nxProject, nxTarget } = parent;

    const projectDef = (await getNxWorkspaceProjects())[nxProject.project];
    if (!projectDef) {
      return;
    }

    const { targets } = projectDef;
    if (!targets) {
      return;
    }

    const target = targets[nxTarget.name];
    if (!target) {
      return;
    }

    const { configurations } = target;
    if (!configurations) {
      return;
    }

    return Object.keys(configurations).map((configuration) => ({
      id: `${nxProject.project}:${nxTarget.name}:${configuration}`,
      contextValue: 'target',
      nxProject,
      nxTarget: { name: nxTarget.name, configuration },
      label: configuration,
      collapsible: TreeItemCollapsibleState.None,
    }));
  }
}
