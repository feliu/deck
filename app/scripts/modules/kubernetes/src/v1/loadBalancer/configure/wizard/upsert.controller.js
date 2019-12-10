'use strict';

const angular = require('angular');

import { AccountService, LoadBalancerWriter, TaskMonitor } from '@spinnaker/core';
import { KUBERNETES_V1_NAMESPACE_SELECTFIELD_DIRECTIVE } from '../../../namespace/selectField.directive';
import { KUBERNETES_V1_LOADBALANCER_TRANSFORMER } from '../../transformer';
import UIROUTER_ANGULARJS from '@uirouter/angularjs';

export const KUBERNETES_V1_LOADBALANCER_CONFIGURE_WIZARD_UPSERT_CONTROLLER =
  'spinnaker.loadBalancer.kubernetes.create.controller';
export const name = KUBERNETES_V1_LOADBALANCER_CONFIGURE_WIZARD_UPSERT_CONTROLLER; // for backwards compatibility
angular
  .module(KUBERNETES_V1_LOADBALANCER_CONFIGURE_WIZARD_UPSERT_CONTROLLER, [
    UIROUTER_ANGULARJS,
    KUBERNETES_V1_NAMESPACE_SELECTFIELD_DIRECTIVE,
    KUBERNETES_V1_LOADBALANCER_TRANSFORMER,
  ])
  .controller('kubernetesUpsertLoadBalancerController', [
    '$scope',
    '$uibModalInstance',
    '$state',
    'application',
    'loadBalancer',
    'isNew',
    'kubernetesLoadBalancerTransformer',
    function($scope, $uibModalInstance, $state, application, loadBalancer, isNew, kubernetesLoadBalancerTransformer) {
      var ctrl = this;
      $scope.isNew = isNew;

      $scope.pages = {
        basicSettings: require('./basicSettings.html'),
        ports: require('./ports.html'),
        advancedSettings: require('./advancedSettings.html'),
      };

      $scope.state = {
        accountsLoaded: false,
        submitting: false,
      };

      function onApplicationRefresh() {
        // If the user has already closed the modal, do not navigate to the new details view
        if ($scope.$$destroyed) {
          return;
        }
        $uibModalInstance.close();
        var newStateParams = {
          name: $scope.loadBalancer.name,
          accountId: $scope.loadBalancer.account,
          region: $scope.loadBalancer.region,
          provider: 'kubernetes',
        };
        if (!$state.includes('**.loadBalancerDetails')) {
          $state.go('.loadBalancerDetails', newStateParams);
        } else {
          $state.go('^.loadBalancerDetails', newStateParams);
        }
      }

      function onTaskComplete() {
        application.loadBalancers.refresh();
        application.loadBalancers.onNextRefresh($scope, onApplicationRefresh);
      }

      $scope.taskMonitor = new TaskMonitor({
        application: application,
        title: (isNew ? 'Creating ' : 'Updating ') + 'your load balancer',
        modalInstance: $uibModalInstance,
        onTaskComplete: onTaskComplete,
      });

      function initializeEditMode() {
        $scope.state.accountsLoaded = true;
      }

      function initializeCreateMode() {
        AccountService.listAccounts('kubernetes').then(function(accounts) {
          $scope.accounts = accounts;
          $scope.state.accountsLoaded = true;

          var accountNames = _.map($scope.accounts, 'name');
          if (accountNames.length && !accountNames.includes($scope.loadBalancer.account)) {
            $scope.loadBalancer.account = accountNames[0];
          }

          ctrl.accountUpdated();
        });
      }

      function updateLoadBalancerNames() {
        var account = $scope.loadBalancer.credentials,
          namespace = $scope.loadBalancer.namespace;

        const accountLoadBalancersByNamespace = {};
        application
          .getDataSource('loadBalancers')
          .refresh(true)
          .then(() => {
            application.getDataSource('loadBalancers').data.forEach(loadBalancer => {
              if (loadBalancer.account === account) {
                accountLoadBalancersByNamespace[loadBalancer.namespace] =
                  accountLoadBalancersByNamespace[loadBalancer.namespace] || [];
                accountLoadBalancersByNamespace[loadBalancer.namespace].push(loadBalancer.name);
              }
            });
            $scope.existingLoadBalancerNames = accountLoadBalancersByNamespace[namespace] || [];
          });
      }

      // initialize controller
      if (loadBalancer) {
        $scope.loadBalancer = kubernetesLoadBalancerTransformer.convertLoadBalancerForEditing(loadBalancer);
        initializeEditMode();
      } else {
        $scope.loadBalancer = kubernetesLoadBalancerTransformer.constructNewLoadBalancerTemplate();
        updateLoadBalancerNames();
        initializeCreateMode();
      }

      // Controller API
      this.updateName = function() {
        $scope.loadBalancer.name = this.getName();
      };

      this.getName = function() {
        var loadBalancer = $scope.loadBalancer;
        var loadBalancerName = [application.name, loadBalancer.stack || '', loadBalancer.detail || ''].join('-');
        return _.trimEnd(loadBalancerName, '-');
      };

      this.accountUpdated = function() {
        AccountService.getAccountDetails($scope.loadBalancer.account).then(function(details) {
          $scope.namespaces = details.namespaces;
          ctrl.namespaceUpdated();
        });
      };

      this.namespaceUpdated = function() {
        updateLoadBalancerNames();
        ctrl.updateName();
      };

      this.submit = function() {
        var descriptor = isNew ? 'Create' : 'Update';

        this.updateName();
        $scope.taskMonitor.submit(function() {
          var zones = {};
          // TODO(lwander) make generic Q2 2016
          zones[$scope.loadBalancer.namespace] = [$scope.loadBalancer.namespace];
          let params = {
            cloudProvider: 'kubernetes',
            availabilityZones: zones,
          };
          return LoadBalancerWriter.upsertLoadBalancer($scope.loadBalancer, application, descriptor, params);
        });
      };

      this.cancel = function() {
        $uibModalInstance.dismiss();
      };
    },
  ]);
